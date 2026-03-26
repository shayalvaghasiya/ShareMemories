import type { Metadata } from "next";
import Home from "../../page";

type EventPageProps = {
  params: {
    eventCode: string;
  };
};

type EventMetadataDetails = {
  eventName: string | null;
  hasPreviewImage: boolean;
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

async function fetchEventMetadataDetails(eventCode: string): Promise<EventMetadataDetails> {
  try {
    const apiUrl = getMetadataApiUrl();
    const response = await fetch(`${apiUrl}/events/${eventCode}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return { eventName: null, hasPreviewImage: false };
    }

    const data = await response.json();
    return {
      eventName: data?.event_name || null,
      hasPreviewImage: !!data?.preview_image_path,
    };
  } catch {
    return { eventName: null, hasPreviewImage: false };
  }
}

export async function generateMetadata({ params }: EventPageProps): Promise<Metadata> {
  const details = await fetchEventMetadataDetails(params.eventCode);
  const displayName = details.eventName || params.eventCode;
  const description = `View your photos from ${displayName} wedding`;
  const previewImageUrl = details.hasPreviewImage
    ? `/api/events/${encodeURIComponent(params.eventCode)}/preview-image`
    : "/event-preview.svg";

  return {
    title: "ShareMemories",
    description,
    openGraph: {
      title: "ShareMemories",
      description,
      type: "website",
      images: [
        {
          url: previewImageUrl,
          alt: `${displayName} wedding preview`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "ShareMemories",
      description,
      images: [previewImageUrl],
    },
  };
}

export default function EventPage({ params }: EventPageProps) {
  return <Home initialEventCode={params.eventCode} />;
}
