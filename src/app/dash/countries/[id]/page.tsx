import { CountryBrowser } from "@/components/leads/countries";
export default async function CountryPage({params}:{params:Promise<{id:string}>}) { const {id}=await params;return <CountryBrowser countryId={id}/>; }
