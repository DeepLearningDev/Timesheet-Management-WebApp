import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Timesheet Management WebApp",
    short_name: "Timesheet",
    description: "Track clock-ins, convert myTime, and manage weekly hours.",
    start_url: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#0ea5e9",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
  };
}
