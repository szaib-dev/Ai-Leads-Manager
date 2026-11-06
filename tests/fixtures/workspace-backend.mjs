// Local browser-only transport fixture. This file is never imported by application code.
import { createServer } from "node:http";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { randomUUID, randomBytes, createHash } from "node:crypto";
export async function startWorkspaceFixture() {
  const pages = [],
    leads = [],
    chats = [],
    messages = [],
    calls = [],
    operations = [];
  const apiKeys=[], apiLogs=[], apiFollowups=[], apiReceipts=new Map();
  let apiEnabled=true;
  let user,
    revision = 0;
  const ledgerPath = ".local-test-output/provider-verification-usage.json";
  const usage = existsSync(ledgerPath)
    ? JSON.parse(readFileSync(ledgerPath, "utf8"))
    : [];
  const saveUsage = () =>
    writeFileSync(ledgerPath, JSON.stringify(usage, null, 2));
  const importRequests = new Map();
  const now = () => new Date().toISOString();
  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET,POST,PATCH,DELETE,HEAD,OPTIONS",
    );
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    res.setHeader("Content-Type", "application/json");
    let text = "";
    for await (const part of req) text += part;
    const body = text ? JSON.parse(text) : {},
      url = new URL(req.url, "http://127.0.0.1");
    const send = (value) => res.end(JSON.stringify(value));
    if (url.pathname === "/auth/v1/admin/users" && req.method === "POST") {
      user = {
        id: randomUUID(),
        aud: "authenticated",
        role: "authenticated",
        email: body.email,
        app_metadata: { provider: "email" },
        user_metadata: {},
        created_at: now(),
        email_confirmed_at: now(),
      };
      return send(user);
    }
    if (
      url.pathname.startsWith("/auth/v1/admin/users/") &&
      req.method === "DELETE"
    )
      return send({});
    if (url.pathname === "/auth/v1/token") {
      const jwt = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: user.id, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) })).toString("base64url")}.${randomBytes(32).toString("base64url")}`;
      return send({
        access_token: jwt,
        refresh_token: "fixture-refresh",
        expires_in: 3600,
        token_type: "bearer",
        user,
      });
    }
    if (url.pathname === "/auth/v1/user") return send(user);
    if (url.pathname === "/auth/v1/logout") {
      res.writeHead(204).end();
      return;
    }
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const name = url.pathname.split("/").at(-1);
      const row = leads.find(
        (l) => l.id === (body.p_id ?? body.p_lead ?? body.p_lead_id),
      );
      if(name === "country_structure")return send({countries:[],assignments:pages.map(p=>({id:p.id,country_id:null}))});
      if(name === "manage_whatsapp"){
        if(!row){res.writeHead(400);return send({message:"Lead unavailable"});}
        Object.assign(row,{status:"whatsapp",whatsapp_status:body.p_status,whatsapp_notes:body.p_notes,whatsapp_last_interaction:body.p_date,updated_at:now()});revision++;return send(true);
      }
      if(name === "commit_import"){
        if(importRequests.has(body.p_request))return send(importRequests.get(body.p_request));
        let target=body.p_page;
        if(body.p_mode==="new"){target=randomUUID();pages.push({id:target,name:body.p_new_name,description:"",created_at:now()});}
        if(!pages.some(p=>p.id===target)){res.writeHead(400);return send({message:"Page unavailable"});}
        let imported=0,duplicates=0;
        for(const entry of body.p_rows){
          if(entry.google_maps_url&&leads.some(l=>l.google_maps_url===entry.google_maps_url)){duplicates++;continue;}
          leads.push({id:randomUUID(),owner_id:user.id,page_id:target,phone:"",website_url:"",country:"",location:"",status:"new",notes:"",attempts:0,failed_attempts:0,updated_at:now(),created_at:now(),archived_at:null,deleted_at:null,...entry});imported++;
        }
        revision++;const result={id:randomUUID(),pageId:target,imported,duplicates,invalid:0,replaced:0};importRequests.set(body.p_request,result);return send(result);
      }
      // UI transport fixture only. Database authorization is tested in integrations.sql.
      if(name === "integration_state") return send({enabled:apiEnabled,keys:apiKeys.map(({secret_hash,...key})=>{void secret_hash;return key;}),logs:apiLogs.slice(-30).reverse()});
      if(name === "integration_toggle"){apiEnabled=body.p_enabled;return send(null);}
      if(name === "integration_manage_key"){
        if(!body.p_id) {const k={id:randomUUID(),name:body.p_name,prefix:body.p_prefix,secret_hash:body.p_hash,scopes:body.p_scopes,enabled:true,revoked_at:null,expires_at:body.p_expires,last_used_at:null};apiKeys.push(k);return send(k.id);}
        const k=apiKeys.find(k=>k.id===body.p_id);if(!k||k.revoked_at){res.writeHead(400);return send({message:"Key unavailable"});}k.scopes=body.p_scopes;k.enabled=body.p_enabled;if(body.p_revoke)k.revoked_at=now();return send(k.id);
      }
      if(name === "integration_request"){
        const k=apiKeys.find(k=>k.secret_hash===createHash("sha256").update(body.p_token).digest("hex"));let status=200,code="ok",data;
        const scope=["pages.list","leads.search","leads.get"].includes(body.p_action)?"leads.read":body.p_action;
        if(!k||k.revoked_at){status=401;code="invalid_api_key";}else if(!apiEnabled||!k.enabled){status=403;code="api_disabled";}else if(!k.scopes.includes(scope)){status=403;code="permission_disabled";}
        if(status===200){const receipt=apiReceipts.get(k.id+body.p_request);
          if(receipt)data=receipt;
          else if(body.p_action==="pages.list")data=pages;
          else if(body.p_action==="leads.search")data=leads.filter(l=>l.business_name.includes(body.p_payload.query));
          else if(body.p_action==="meetings.create"){const l=leads.find(l=>l.id===body.p_payload.leadId);l.status="meeting_booked";l.updated_at=now();const local=new Date(Date.parse(body.p_payload.startsAt)+5*3600000).toISOString();const f={id:randomUUID(),lead_id:l.id,owner_id:user.id,scheduled_date:local.slice(0,10),scheduled_time:local.slice(11,19),kind:"meeting",cancelled_at:null};apiFollowups.push(f);data={id:f.id,leadId:l.id};apiReceipts.set(k.id+body.p_request,data);revision++;}
        }
        if(k)apiLogs.push({id:randomUUID(),key_id:k.id,request_id:body.p_request,action:body.p_action,status,code,created_at:now()});return send({status,body:status===200?{data}:{error:{code}}});
      }
      if (name === "ai_csv_reserve") {
        const cost = (body.p_input_bound * 0.3 + 1024 * 1.2) / 1000000;
        if (usage.reduce((sum, x) => sum + x.cost, 0) + cost > 0.05) {
          res.writeHead(400);
          return send({ message: "Verification budget exhausted ($0.05)" });
        }
        usage.push({ id: body.p_request, cost, reserved: true });
        saveUsage();
        return send({ reserved: cost });
      }
      if (name === "ai_csv_settle") {
        const entry = usage.find((x) => x.id === body.p_request);
        if (entry && body.p_input !== null) {
          entry.cost = (body.p_input * 0.3 + body.p_output * 1.2) / 1000000;
          entry.input = body.p_input;
          entry.output = body.p_output;
          entry.reserved = false;
          saveUsage();
        }
        return send(null);
      }
      if (name === "ai_context")
        return send({
          pages: pages.map((p) => ({ id: p.id, name: p.name })),
          currentPage: body.p_page,
          selectedCount: 0,
          verifiedRecentImport: null,
          imports: [],
        });
      if (name === "ai_chat_claim") {
        const existing = messages.find((m) => m.id === body.p_assistant);
        if (existing?.status === "completed")
          return send({ state: "replay", message: existing });
        let chat = chats.find((c) => c.id === body.p_conversation);
        if (!chat) {
          chat = {
            id: body.p_conversation,
            owner_id: user.id,
            title: body.p_content,
            scope_page_id: body.p_scope,
            updated_at: now(),
          };
          chats.push(chat);
        }
        if (!messages.some((m) => m.id === body.p_user))
          messages.push({
            id: body.p_user,
            owner_id: user.id,
            conversation_id: chat.id,
            role: "user",
            content: body.p_content,
            status: "completed",
            error: null,
            reply_to: null,
            operation_id: null,
            created_at: now(),
          });
        const message = {
          id: body.p_assistant,
          owner_id: user.id,
          conversation_id: chat.id,
          role: "assistant",
          content: "",
          status: "processing",
          error: null,
          reply_to: body.p_user,
          operation_id: null,
          created_at: now(),
        };
        messages.push(message);
        return send({
          state: "claimed",
          attempt: randomUUID(),
          previousResult: chat.last_result_id ?? null,
        });
      }
      if (name === "ai_chat_context") {
        const current = messages.find((m) => m.id === body.p_before);
        return send({
          recent: messages
            .filter(
              (m) =>
                m.conversation_id === body.p_conversation &&
                m.status === "completed" &&
                m.id !== current.reply_to,
            )
            .slice(-6),
          olderRelevant: [],
          previousResult: null,
        });
      }
      if (name === "ai_chat_finish") {
        const message = messages.find((m) => m.id === body.p_id);
        Object.assign(message, {
          content: body.p_content,
          status: body.p_status,
          error: body.p_error,
          operation_id: body.p_operation,
        });
        const chat = chats.find((c) => c.id === message.conversation_id);
        chat.last_result_id = body.p_operation;
        return send(true);
      }
      if (name === "ai_stage") {
        const command = body.p_command;
        let matching = leads.filter(
          (l) => !command.pageId || l.page_id === command.pageId,
        );
        if (JSON.stringify(command.filter).toLowerCase().includes("pakistan"))
          matching = matching.filter((l) => l.country === "Pakistan");
        const result = {
          id: randomUUID(),
          request_id: body.p_request,
          action: "search",
          status: "completed",
          mode: "strict",
          count: matching.length,
          requiresApproval: false,
          expiresAt: now(),
          page: 1,
          totalPages: 1,
          rows: [],
          summary: `Matched ${matching.length} leads.`,
          scope: {
            pageId: command.pageId,
            importId: null,
            destinationId: null,
          },
        };
        operations.push(result);
        return send(result);
      }
      if (name === "ai_plan_result")
        return send(operations.find((o) => o.id === body.p_id));
      if (name === "manage_page") {
        const id = randomUUID();
        pages.push({
          id,
          name: body.p_name,
          description: body.p_description,
          created_at: now(),
        });
        revision++;
        return send(id);
      }
      if (name === "workspace_state")
        return send({
          revision,
          pages: pages.map((p) => ({
            ...p,
            lead_count: leads.filter((l) => l.page_id === p.id).length,
            new_count: 0,
            contacted_count: 0,
            followup_count: 0,
          })),
        });
      if (name === "workspace_leads") {
        let list = leads.filter(
          (l) =>
            (!body.p_page || l.page_id === body.p_page) &&
            (!body.p_search ||
              l.business_name
                .toLowerCase()
                .includes(body.p_search.toLowerCase())) &&
            (body.p_status === "all" || l.status === body.p_status) &&
            (!body.p_phone || l.phone),
        );
        list = list.sort((a, b) =>
          body.p_sort === "name"
            ? a.business_name.localeCompare(b.business_name)
            : b.created_at.localeCompare(a.created_at) ||
              b.id.localeCompare(a.id),
        );
        return send({
          rows: list.slice(body.p_offset, body.p_offset + body.p_limit),
          total: list.length,
          summary: {
            total: list.length,
            ready: list.length,
            contacted: 0,
            unanswered: 1,
          },
        });
      }
      if (name === "save_lead") {
        if (!row) return send(null);
        Object.assign(row, body.p_data, { updated_at: now() });
        revision++;
        return send(randomUUID());
      }
      if (name === "record_call") {
        row.attempts++;
        row.failed_attempts++;
        row.status = body.p_outcome;
        row.updated_at = now();
        calls.push({
          id: randomUUID(),
          lead_id: row.id,
          occurred_at: now(),
          business_name: row.business_name,
          outcome: body.p_outcome,
          attempt_number: 1,
          notes: body.p_notes,
          voided_at: null,
        });
        revision++;
        return send(randomUUID());
      }
      if (name === "is_lead_suppressed") return send(false);
      if (name === "calling_history_range")
        return send({
          rows: calls,
          total: calls.length,
          summary: {
            attempts: 1,
            answered: 0,
            interested: 0,
            rejected: 0,
            followups: 0,
            meetings: 0,
            callbacks: 0,
            answer_rate: 0,
            conversion_rate: 0,
          },
        });
      if (name === "ai_assistant_state")
        return send({
          mode: "strict",
          budget: {
            configured: false,
            budget: 1.75,
            estimated_spent: 0,
            model: "DeepSeek fixture",
            pricing_verified: "2026-11-04",
            input_tokens: 0,
            output_tokens: 0,
          },
          history: [],
        });
      if (name.includes("history"))
        return send({
          rows: [],
          attempts: [],
          changes: [],
          undo_id: null,
          total: 0,
        });
      res.writeHead(400);
      return send({ message: `Unsupported fixture RPC ${name}` });
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.split("/").at(-1);
      let data =
        table === "followups" ? apiFollowups : table === "leads"
          ? leads
          : table === "operations"
            ? operations
            : table === "ai_conversations"
              ? chats
              : table === "ai_chat_messages"
                ? messages
                : table === "workspace_sync"
                  ? [{ owner_id: user.id, revision, privacy_revision: 0 }]
                  : table === "lead_attempt_summary"
                    ? leads.map((l) => ({
                        lead_id: l.id,
                        owner_id: user.id,
                        total_attempts: l.attempts,
                        consecutive_failed_attempts: l.failed_attempts,
                      }))
                    : [];
      if (req.method === "POST" && table === "leads") {
        const incoming = (Array.isArray(body) ? body : [body]).map((l) => ({
          id: randomUUID(),
          owner_id: user.id,
          status: "new",
          notes: "",
          attempts: 0,
          failed_attempts: 0,
          updated_at: now(),
          created_at: now(),
          archived_at: null,
          deleted_at: null,
          ...l,
        }));
        leads.push(...incoming);
        revision++;
        return send(incoming);
      }
      for (const [key, value] of url.searchParams) {
        if (value.startsWith("eq."))
          data = data.filter((r) => String(r[key]) === value.slice(3));
        if (value.startsWith("lt."))
          data = data.filter((r) => r[key] < value.slice(3));
      }
      if (table === "leads" && url.searchParams.has("order"))
        data = [...data].sort(
          (a, b) =>
            b.created_at.localeCompare(a.created_at) ||
            b.id.localeCompare(a.id),
        );
      const limit = Number(url.searchParams.get("limit") ?? data.length);
      data = data.slice(0, limit);
      res.setHeader(
        "Content-Range",
        `0-${Math.max(0, data.length - 1)}/${data.length}`,
      );
      return send(
        req.headers.accept?.includes("vnd.pgrst.object")
          ? (data[0] ?? null)
          : data,
      );
    }
    res.writeHead(404);
    send({ message: "Fixture route unavailable" });
  });
  await new Promise((r) => server.listen(55434, "127.0.0.1", r));
  return {
    url: "http://127.0.0.1:55434",
    key: "sb_publishable_browser_fixture",
    adminKey: "sb_secret_browser_fixture",
    close: () => new Promise((r) => server.close(r)),
    seedConversation(first) {
      chats.push({
        id: first.conversationId,
        owner_id: user.id,
        title: first.text,
        scope_page_id: null,
        updated_at: now(),
      });
      for (let i = 0; i < 2; i++)
        messages.push({
          id: randomUUID(),
          owner_id: user.id,
          conversation_id: first.conversationId,
          role: "user",
          content: i ? "How many Pakistani leads do I have?" : first.text,
          status: "completed",
          error: null,
          reply_to: null,
          operation_id: null,
          created_at: now(),
        });
    },
  };
}
