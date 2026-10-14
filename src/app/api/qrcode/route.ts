import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";

export async function GET(request: NextRequest) {
  const tenant = request.nextUrl.searchParams.get("tenant") || "demo";
  const table = request.nextUrl.searchParams.get("table") || "1";

  // Production URL resolution: Always route customers' phones to live Vercel URL
  let baseUrl = process.env.RMS_WEB_APP_URL || process.env.NEXT_PUBLIC_BASE_URL;
  if (!baseUrl || baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1")) {
    baseUrl = "https://rms-web-app-rho.vercel.app";
  }

  const target = new URL("/menu", baseUrl);
  target.searchParams.set("tenant", tenant);
  target.searchParams.set("table", table);
  target.searchParams.set("type", "dinein");

  const dataUrl = await QRCode.toDataURL(target.toString(), {
    margin: 1,
    width: 340,
    color: {
      dark: "#000000",
      light: "#ffffff"
    }
  });

  return NextResponse.json({
    url: target.toString(),
    data_url: dataUrl
  });
}
