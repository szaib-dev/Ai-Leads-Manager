"use client";
import {useState} from "react";
import dynamic from "next/dynamic";
import {ActivityPage} from "@/components/dashboard/activity";
import {ListSkeleton} from "@/components/shared/list-skeleton";
const LeadWorkspace=dynamic(()=>import("./lead-workspace").then(m=>m.LeadWorkspace),{loading:()=> <ListSkeleton/>});
export function CallAttempts(){
 const [view,setView]=useState("all");
 return <><div className="attempt-view-tabs" role="group" aria-label="Attempt view"><button aria-pressed={view==="all"} onClick={()=>setView("all")}>All attempts</button><button aria-pressed={view==="retry"} onClick={()=>setView("retry")}>Retry queue</button></div>{view==="all"?<ActivityPage compact/>:<LeadWorkspace mode="attempts"/>}</>;
}
