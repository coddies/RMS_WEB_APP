import { NextRequest, NextResponse } from "next/server";
import { applyStaffCookie, getAuthenticatedStaff } from "@/lib/staff-auth";
import { serverSupabase } from "@/lib/supabase";

type QueuedOrder = {
  sequence_no: number;
  order_type: "DINE_IN" | "DELIVERY";
  table_number: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  items: { item_id: string; quantity: number; price_at_order: number }[];
  total_amount: number;
  created_at: string;
};

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedStaff(request);
  if (!auth || !["admin", "cashier"].includes(auth.session.role)) {
    return NextResponse.json({ error: "Sign in with a cashier or manager account." }, { status: 401 });
  }

  try {
    const body = await request.json() as { orders?: QueuedOrder[] };
    if (!Array.isArray(body.orders) || body.orders.length < 1 || body.orders.length > 100) {
      return NextResponse.json({ error: "Sync must contain 1 to 100 queued orders." }, { status: 400 });
    }
    let previousSequence = 0;
    for (const order of body.orders) {
      if (!Number.isSafeInteger(order.sequence_no) || order.sequence_no <= previousSequence || !Array.isArray(order.items) || order.items.length < 1) {
        return NextResponse.json({ error: "Queued orders must contain items and be in ascending sequence order." }, { status: 400 });
      }
      previousSequence = order.sequence_no;
    }

    const db = serverSupabase();
    const synced = [];
    for (const order of body.orders) {
      const { data, error } = await db.rpc("rms_sync_offline_order", {
        p_tenant_id: auth.session.tenantId,
        p_local_sequence_no: order.sequence_no,
        p_order: {
          order_type: order.order_type,
          table_number: order.table_number,
          customer_name: order.customer_name,
          customer_phone: order.customer_phone,
          customer_address: order.customer_address,
          items: order.items,
          total_amount: order.total_amount,
          created_at: order.created_at,
        },
      });
      if (error) throw new Error(`Order ${order.sequence_no} did not sync: ${error.message}`);
      synced.push({ sequence_no: order.sequence_no, ...(data as { id: string; order_number: number; duplicate: boolean }) });
    }

    const response = NextResponse.json({ synced });
    return auth.renewedCookie ? applyStaffCookie(response, auth.renewedCookie, auth.session.expiresAt) : response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Offline orders could not be synced." }, { status: 503 });
  }
}
