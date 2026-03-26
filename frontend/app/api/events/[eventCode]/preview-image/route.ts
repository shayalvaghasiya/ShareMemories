import { NextRequest, NextResponse } from "next/server";

type RouteProps = {
  params: {
    eventCode: string;
  };
};

function getMetadataApiUrl(): string {
  const configured = process.env.METADATA_API_URL?.trim();
  if (configured) {
    return configured;
  }

  const publicApi = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (publicApi) {
    return publicApi;
  }

  return process.env.NODE_ENV === "production" ? "http://backend:8000" : "http://localhost:8000";
}

export async function GET(request: NextRequest, { params }: RouteProps) {
  try {
    const apiUrl = getMetadataApiUrl();
    const response = await fetch(`${apiUrl}/events/${encodeURIComponent(params.eventCode)}/preview-image`, {
      cache: "no-store",
    });

    if (!response.ok || !response.body) {
      return NextResponse.redirect(new URL("/event-preview.svg", request.url));
    }

    return new NextResponse(response.body, {
      status: 200,
      headers: {
        "Content-Type": response.headers.get("content-type") || "image/jpeg",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch {
    return NextResponse.redirect(new URL("/event-preview.svg", request.url));
  }
}
