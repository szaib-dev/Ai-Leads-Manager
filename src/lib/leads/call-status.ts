import type { LeadStatus } from "@/types";
export function isCallStatus(status: string): status is Exclude<LeadStatus,"New"> {
 return ["No Answer","Voicemail","Interested","Not Interested","Follow-up","Meeting Booked","Awaiting Callback","WhatsApp"].includes(status);
}
export const callOutcomeStatus:Record<string,string>={callback_requested:"follow_up",no_answer:"no_answer",voicemail:"voicemail",interested:"interested",not_interested:"not_interested",meeting_booked:"meeting_booked",awaiting_callback:"awaiting_callback",whatsapp:"whatsapp"};
