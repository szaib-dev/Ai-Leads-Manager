import type { NextConfig } from "next";
import { getSupabaseConfig } from "./src/lib/supabase/config";
// Fail before compilation if a secret was accidentally assigned a NEXT_PUBLIC variable.
getSupabaseConfig();
const config: NextConfig = {
  devIndicators: false,
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
};
export default config;
