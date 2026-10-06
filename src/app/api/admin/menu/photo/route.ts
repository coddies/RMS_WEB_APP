import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { applyStaffCookie, getAuthenticatedStaff } from "@/lib/staff-auth";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedStaff(request);
  if (!auth || auth.session.role !== "admin") return NextResponse.json({ error: "Manager/admin sign-in required." }, { status: 401 });
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloud || !apiKey || !apiSecret) return NextResponse.json({ error: "Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in .env.local." }, { status: 503 });
  try {
    const incoming = await request.formData(); const file = incoming.get("file");
    if (!(file instanceof File) || !file.type.startsWith("image/") || file.size < 1 || file.size > 8 * 1024 * 1024) return NextResponse.json({ error: "Choose a compressed image smaller than 8 MB." }, { status: 400 });
    const timestamp = Math.floor(Date.now() / 1000).toString(); const folder = "menu-items";
    const signature = createHash("sha1").update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`).digest("hex");
    const upload = new FormData(); upload.append("file", file, file.name || "menu-item.jpg"); upload.append("api_key", apiKey); upload.append("timestamp", timestamp); upload.append("folder", folder); upload.append("signature", signature);
    const uploadResponse = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/image/upload`, { method: "POST", body: upload, cache: "no-store" });
    const result = await uploadResponse.json() as { secure_url?: string; error?: { message?: string } };
    if (!uploadResponse.ok || !result.secure_url) return NextResponse.json({ error: result.error?.message ?? "Cloudinary could not upload this photo." }, { status: 502 });
    const response = NextResponse.json({ secure_url: result.secure_url });
    return auth.renewedCookie ? applyStaffCookie(response, auth.renewedCookie, auth.session.expiresAt) : response;
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Photo upload failed." }, { status: 502 }); }
}
