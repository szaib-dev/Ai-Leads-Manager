import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
export function MapsButton({ url, name }: { url: string; name: string }) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return (
    <Button
      asChild
      variant="ghost"
      size="icon"
      style={{ minWidth: 44, minHeight: 44, flex: "0 0 44px" }}
    >
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open Google Maps for ${name}`}
        title="Open Google Maps"
      >
        <MapPin size={17} />
      </a>
    </Button>
  );
}
