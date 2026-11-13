import { CityBrowser } from "@/components/leads/cities";
export default async function CityPage({params}:{params:Promise<{id:string}>}) {const {id}=await params;return <CityBrowser cityId={id}/>;}
