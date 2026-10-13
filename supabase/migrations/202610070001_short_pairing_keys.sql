ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS license_key_issued_at timestamptz;

CREATE TABLE IF NOT EXISTS public.pairing_attempts (
  ip_address text PRIMARY KEY,
  failed_attempts integer NOT NULL DEFAULT 1,
  locked_until timestamptz,
  last_attempt_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pairing_attempts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.rms_issue_pairing_key(p_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  one_time_key text;
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  special_chars text := '-_@';
  generated text := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id) THEN
    RAISE EXCEPTION 'TENANT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  -- Generate 7 alphanumeric + 3 special characters, then shuffle
  WITH char_pool AS (
    SELECT substr(chars, floor(random() * length(chars))::int + 1, 1) AS c FROM generate_series(1, 7)
    UNION ALL
    SELECT substr(special_chars, floor(random() * length(special_chars))::int + 1, 1) AS c FROM generate_series(1, 3)
  )
  SELECT string_agg(c, '' ORDER BY random()) INTO generated FROM char_pool;

  one_time_key := generated;

  UPDATE public.tenants
  SET license_key = pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(one_time_key, 'UTF8')), 'hex'
  ), 
  hardware_fingerprint = NULL,
  license_key_issued_at = now()
  WHERE id = p_tenant_id;

  RETURN one_time_key;
END;
$$;

CREATE OR REPLACE FUNCTION public.rms_pair_local_bridge(p_license_key text, p_fingerprint text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  paired_tenant public.tenants%ROWTYPE;
  supplied_hash text;
  client_ip text;
  attempt_record public.pairing_attempts%ROWTYPE;
BEGIN
  -- Extract IP
  BEGIN
    client_ip := current_setting('request.headers', true)::json->>'x-forwarded-for';
    IF client_ip IS NULL THEN
      client_ip := 'unknown_ip';
    ELSE
      client_ip := split_part(client_ip, ',', 1);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    client_ip := 'unknown_ip';
  END;

  -- Check rate limit FIRST
  SELECT * INTO attempt_record FROM public.pairing_attempts WHERE ip_address = client_ip;
  IF FOUND AND attempt_record.locked_until IS NOT NULL AND attempt_record.locked_until > now() THEN
    RETURN 'ERROR_RATE_LIMIT_EXCEEDED';
  END IF;

  -- Basic validation
  IF p_license_key IS NULL OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$' THEN
    PERFORM public.rms_record_pairing_failure(client_ip);
    RETURN 'ERROR_PAIRING_KEY_INVALID';
  END IF;

  -- Allow 64-char (old format) or 10-char (new format)
  IF p_license_key !~ '^rms_[a-f0-9]{64}$' AND length(p_license_key) <> 10 THEN
    PERFORM public.rms_record_pairing_failure(client_ip);
    RETURN 'ERROR_PAIRING_KEY_INVALID';
  END IF;

  supplied_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(p_license_key, 'UTF8')), 'hex'
  );

  SELECT * INTO paired_tenant
  FROM public.tenants
  WHERE license_key = supplied_hash
  FOR UPDATE;

  IF paired_tenant.id IS NULL THEN
    PERFORM public.rms_record_pairing_failure(client_ip);
    RETURN 'ERROR_PAIRING_KEY_INVALID';
  END IF;

  -- Check 30 minute expiry (only for keys that have issue time)
  IF paired_tenant.license_key_issued_at IS NOT NULL AND paired_tenant.license_key_issued_at < now() - interval '30 minutes' THEN
    PERFORM public.rms_record_pairing_failure(client_ip);
    RETURN 'ERROR_PAIRING_KEY_EXPIRED';
  END IF;

  IF paired_tenant.hardware_fingerprint IS NOT NULL
     AND paired_tenant.hardware_fingerprint <> p_fingerprint THEN
    PERFORM public.rms_record_pairing_failure(client_ip);
    RETURN 'ERROR_PAIRING_KEY_ALREADY_REGISTERED';
  END IF;

  -- Success: reset failures for this IP
  DELETE FROM public.pairing_attempts WHERE ip_address = client_ip;

  UPDATE public.tenants
  SET hardware_fingerprint = p_fingerprint
  WHERE id = paired_tenant.id;

  RETURN paired_tenant.slug;
END;
$$;

CREATE OR REPLACE FUNCTION public.rms_record_pairing_failure(p_ip text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.pairing_attempts (ip_address, failed_attempts, last_attempt_at)
  VALUES (p_ip, 1, now())
  ON CONFLICT (ip_address) DO UPDATE
  SET failed_attempts = CASE 
        WHEN public.pairing_attempts.locked_until IS NOT NULL AND public.pairing_attempts.locked_until < now() THEN 1 
        ELSE public.pairing_attempts.failed_attempts + 1 
      END,
      last_attempt_at = now(),
      locked_until = CASE 
        WHEN (CASE WHEN public.pairing_attempts.locked_until IS NOT NULL AND public.pairing_attempts.locked_until < now() THEN 1 ELSE public.pairing_attempts.failed_attempts + 1 END) >= 5 
        THEN now() + interval '15 minutes'
        ELSE NULL
      END;
END;
$$;

REVOKE ALL ON FUNCTION public.rms_record_pairing_failure(text) FROM PUBLIC, anon, authenticated;
