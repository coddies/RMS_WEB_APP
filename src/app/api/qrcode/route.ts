import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
export async function GET(request: NextRequest) {
  const tenant = request.nextUrl.searchParams.get("tenant"); const table = request.nextUrl.searchParams.get("table");
  if (!tenant || !table) return NextResponse.json({ error: "Tenant and table are required." }, { status: 400 });
  const target = new URL("/menu", process.env.NEXT_PUBLIC_BASE_URL ?? request.nextUrl.origin);
  target.searchParams.set("tenant", tenant); target.searchParams.set("table", table); target.searchParams.set("type", "dinein");
  return NextResponse.json({ url: target.toString(), data_url: await QRCode.toDataURL(target.toString(), { margin: 1, width: 320 }) });
}
