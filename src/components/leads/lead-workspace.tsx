"use client";
import { MapsButton } from "./maps-button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";
import { useLiveSelection } from "@/lib/realtime/use-live-selection";
import { useEffect, useState } from "react";
import { useSessionLeadView } from "./use-session-lead-view";
import { formatMoment, dayInZone } from "@/lib/analytics/contracts";
import Link from "next/link";
import {
  ArrowDownUp,
  ArrowLeft,
  ArrowUpRight,
  Archive,
  ChevronLeft,
  ChevronRight,
  Folder,
  ListFilter,
  MoreHorizontal,
  Phone,
  Plus,
  Search,
  Upload,
  X,
} from "lucide-react";
import { useWorkspace } from "@/components/providers";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { LeadDetails } from "./lead-details";
import { AttemptProgress, LeadCard } from "./lead-card";
import { initials, phoneLink, shortDate } from "@/lib/utils";
import { statuses, type Lead } from "@/types";
import type { LeadFilters } from "@/lib/leads/contracts";
import { saveLead } from "@/lib/leads/actions";
import { useRemoteLeads, useMobileLayout } from "./use-remote-leads";
import { CsvImportDialog } from "./csv-import-dialog";
import { ImportHistory } from "./import-history";
import { AttemptDialog } from "./attempt-dialog";
import { SafeCallLink } from "./safe-call-link";
type Filters = LeadFilters;
const freshFilters: Filters = {
  search: "",
  status: "all",
  phoneOnly: false,
  sort: "newest",
  page: 1,
};
export function LeadWorkspace({
  pageId,
  mode = "page",
}: {
  pageId?: string;
  mode?: "page" | "attempts" | "archive";
}) {
  const {
    ownerId,
    pages,
    refreshPages,
    toast,
    revision,
    timezone,
    aiSelection,
    toggleAiLead,
    clearAiSelection,
  } = useWorkspace();
  const viewKey = `folio.lead-view:${ownerId}:${mode}:${pageId ?? "all"}`;
  const desktopView = useSessionLeadView(`${viewKey}:desktop`, freshFilters);
  const mobileView = useSessionLeadView(`${viewKey}:mobile`, freshFilters);
  const { filters: desktop, setFilters: setDesktop } = desktopView;
  const { filters: mobile, setFilters: setMobile } = mobileView;
  const [selected, setSelected] = useLiveSelection<Lead | null>(null);
  const [attemptId, setAttemptId] = useLiveSelection<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useLiveSelection<Lead | null>(null);
  const aiIds = aiSelection.pageId === pageId ? aiSelection.ids : [];
  const pageInfo = pages.find((p) => p.id === pageId);
  const [historyOpen, setHistoryOpen] = useState(false),
    [version, setVersion] = useState(0),
    [saving, setSaving] = useState(false);
  const mobileLayout = useMobileLayout();
  const desktopRemote = useRemoteLeads(
    desktop,
    pageId,
    mode,
    !mobileLayout,
    version + revision,
  );
  const mobileRemote = useRemoteLeads(
    mobile,
    pageId,
    mode,
    mobileLayout,
    version + revision,
  );
  if (
    !mobileLayout &&
    !desktopRemote.loading &&
    !desktopRemote.error &&
    desktop.page > Math.max(1, Math.ceil(desktopRemote.data.total / 15))
  )
    setDesktop((f) => ({
      ...f,
      page: Math.max(1, Math.ceil(desktopRemote.data.total / 15)),
    }));
  if (
    mobileLayout &&
    !mobileRemote.loading &&
    !mobileRemote.error &&
    mobile.page > Math.max(1, Math.ceil(mobileRemote.data.total / 15))
  )
    setMobile((f) => ({
      ...f,
      page: Math.max(1, Math.ceil(mobileRemote.data.total / 15)),
    }));
  const activeRemote = mobileLayout ? mobileRemote : desktopRemote;
  useEffect(() => {
    (mobileLayout ? mobileView : desktopView).restoreScroll(
      !activeRemote.loading,
    );
  });
  const summaryReady = !activeRemote.loading && !activeRemote.error;
  const summary = activeRemote.data.summary;
  function refresh() {
    setVersion((v) => v + 1);
    void refreshPages().catch(() => toast("Page counts could not refresh."));
  }
  function setSelectedId(id: string | null) {
    setSelected(
      id
        ? (mobileLayout ? mobileRemote : desktopRemote).data.rows.find(
            (l) => l.id === id,
          ) || null
        : null,
    );
  }
  async function archive(id: string, archived: boolean) {
    const lead = (mobileLayout ? mobileRemote : desktopRemote).data.rows.find(
      (l) => l.id === id,
    );
    if (!lead?.updatedAt) return;
    setSaving(true);
    try {
      const r = await saveLead({
        id,
        expected: lead.updatedAt,
        data: {},
        action: archived ? "archive" : "restore",
      });
      if (r.error) toast(r.error);
      else {
        toast(archived ? "Lead archived" : "Lead restored");
        refresh();
      }
    } catch {
      toast("Could not update lead.");
    } finally {
      setSaving(false);
    }
  }
  function renderList(isMobile: boolean) {
    const filters = isMobile ? mobile : desktop;
    const setFilters = isMobile ? setMobile : setDesktop;
    function change(data: Partial<Filters>) {
      setFilters((f) => ({ ...f, ...data, page: data.page ?? 1 }));
    }
    const remote = isMobile ? mobileRemote : desktopRemote;
    const total = remote.data.total;
    const pageCount = Math.max(1, Math.ceil(total / 15));
    const currentPage = filters.page;
    const shown = remote.data.rows;
    const active =
      filters.status !== "all" ||
      filters.phoneOnly ||
      !!filters.search ||
      filters.sort !== "newest";
    const filterFields = (
      <>
        <label className="filter-select-label">
          <span className="sr-only">Filter by status</span>
          <Select
            aria-label={isMobile ? "Mobile status filter" : "Status filter"}
            value={filters.status}
            onValueChange={(value) => change({ status: value })}
          >
            <option value="all">All statuses</option>
            {statuses.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </label>
        <label className="phone-filter" style={{ minHeight: 44, gap: 9 }}>
          <Checkbox
            checked={filters.phoneOnly}
            onChange={(e) => change({ phoneOnly: e.target.checked })}
          />
          With phone only
        </label>
        <label className="sort-select">
          <ArrowDownUp size={14} />
          <Select
            variant="plain"
            aria-label={isMobile ? "Mobile sort leads" : "Sort leads"}
            value={filters.sort}
            onValueChange={(value) =>
              change({ sort: value as Filters["sort"] })
            }
          >
            <option value="newest">Newest first</option>
            <option value="name">Business name</option>
            <option value="attempts">Most attempts</option>
          </Select>
        </label>
      </>
    );
    return (
      <section
        className={isMobile ? "mobile-leads" : "desktop-leads"}
        aria-label={isMobile ? "Mobile lead list" : "Desktop lead list"}
      >
        <div className="list-toolbar">
          <label className="search-field">
            <Search size={17} />
            <input
              placeholder="Search businesses or phone…"
              aria-label={isMobile ? "Search mobile leads" : "Search leads"}
              value={filters.search}
              onChange={(e) => change({ search: e.target.value })}
            />
            {filters.search && (
              <button
                onClick={() => change({ search: "" })}
                aria-label="Clear search"
              >
                <X size={15} />
              </button>
            )}
          </label>
          {isMobile ? (
            <Button
              variant="outline"
              size="icon"
              aria-label="Toggle mobile filters"
              aria-expanded={filterOpen}
              onClick={() => setFilterOpen(!filterOpen)}
            >
              <ListFilter size={18} />
            </Button>
          ) : (
            <div className="desktop-filters">{filterFields}</div>
          )}
        </div>
        {isMobile && filterOpen && (
          <div className="mobile-filter-panel">
            {filterFields}
            <p>Temporary filters · Mobile only</p>
          </div>
        )}
        {active && (
          <div className="active-filter-bar">
            <span>
              {total} matching leads · {isMobile ? "Mobile" : "Desktop"} filters
              only
            </span>
            <button onClick={() => setFilters(freshFilters)}>
              Reset filters <X size={12} />
            </button>
          </div>
        )}
        {aiIds.length > 0 && (
          <div className="active-filter-bar">
            <span>
              {aiIds.length} selected for AI · Open the AI assistant to use this
              selection.
            </span>
            <button onClick={clearAiSelection}>Clear selection</button>
          </div>
        )}
        {remote.loading ? (
          <div className="empty-state" role="status">
            <div className="skeleton" style={{ height: 220, width: "100%" }} />
            <span className="small muted">Loading leads�</span>
          </div>
        ) : remote.error ? (
          <EmptyState
            title="Could not load leads"
            description={remote.error}
            action={<Button onClick={refresh}>Retry</Button>}
          />
        ) : shown.length === 0 ? (
          <EmptyState
            title={
              summary.total === 0
                ? mode === "archive"
                  ? "Your archive is clear"
                  : mode === "attempts"
                    ? "All caught up"
                    : "A fresh page. A fresh start."
                : undefined
            }
            description={
              summary.total === 0
                ? mode === "page"
                  ? "This page is ready for your leads. Import a CSV to get started."
                  : "Leads will appear here as you work through your calls."
                : undefined
            }
            action={
              active ? (
                <Button
                  variant="outline"
                  onClick={() => setFilters(freshFilters)}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : isMobile ? (
          <div className="lead-card-list">
            {shown.map((l) => (
              <div key={l.id}>
                <label
                  className="small muted"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    minHeight: 44,
                  }}
                >
                  <Checkbox
                    checked={aiIds.includes(l.id)}
                    onChange={() => toggleAiLead(l.id, pageId)}
                  />
                  Select for AI
                </label>
                <LeadCard
                  lead={l}
                  onOpen={() => setSelectedId(l.id)}
                  onAttempt={() => setAttemptId(l.id)}
                  progress={mode === "attempts"}
                />
                {mode === "archive" && (
                  <Button
                    className="restore-mobile"
                    variant="outline"
                    disabled={saving}
                    onClick={() => void archive(l.id, false)}
                  >
                    Restore lead
                  </Button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="table-scroll">
            <table className="leads-table">
              <thead>
                <tr>
                  <th>
                    <button
                      onClick={() =>
                        change({
                          sort: filters.sort === "name" ? "newest" : "name",
                        })
                      }
                    >
                      Business name
                      <ArrowDownUp size={12} />
                    </button>
                  </th>
                  <th>Phone number</th>
                  <th>Status</th>
                  <th>
                    {mode === "attempts" ? "Failed attempts" : "Attempts"}
                  </th>
                  <th>
                    {mode === "archive"
                      ? "Archived"
                      : mode === "attempts"
                        ? "Last attempt"
                        : "Last contacted"}
                  </th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            minHeight: 44,
                            minWidth: 24,
                          }}
                        >
                          <Checkbox
                            aria-label={`Select ${l.name} for AI`}
                            checked={aiIds.includes(l.id)}
                            onChange={() => toggleAiLead(l.id, pageId)}
                          />
                        </label>
                        <button
                          className="business-cell"
                          onClick={() => setSelectedId(l.id)}
                        >
                          <span className="business-avatar">
                            {initials(l.name)}
                          </span>
                          <span>
                            <strong>{l.name}</strong>
                            <small>
                              {l.suppressed
                                ? "Do not call · previously rejected"
                                : l.archiveReason === "attempts_exhausted"
                                  ? "Exhausted"
                                  : l.category}
                            </small>
                            {mode === "attempts" && l.lastAttemptNotes && (
                              <small
                                style={{
                                  maxWidth: 230,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }}
                              >
                                {l.lastAttemptNotes}
                              </small>
                            )}
                          </span>
                        </button>
                      </div>
                    </td>
                    <td>
                      {phoneLink(l.phone) ? (
                        <SafeCallLink className="table-phone" lead={l}>
                          {l.phone}
                        </SafeCallLink>
                      ) : (
                        <span className="muted">No phone listed</span>
                      )}
                    </td>
                    <td>
                      <StatusBadge status={l.status} />
                    </td>
                    <td>
                      {mode === "attempts" ? (
                        <div>
                          <AttemptProgress count={l.failedAttempts} />
                          <small className="muted" style={{ display: "block" }}>
                            {l.attempts} total attempts
                          </small>
                          {l.failedAttempts >= 3 && (
                            <span className="review-label">
                              Ready for review
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="attempt-count">
                          {l.attempts}
                          <span> / 3 failed max</span>
                        </span>
                      )}
                    </td>
                    <td className="muted nowrap">
                      {mode === "archive"
                        ? l.archivedAt
                          ? shortDate(
                              l.archivedTimestamp
                                ? dayInZone(
                                    timezone,
                                    new Date(l.archivedTimestamp),
                                  )
                                : l.archivedAt,
                            )
                          : "—"
                        : mode === "attempts" && l.lastAttemptAt
                          ? formatMoment(l.lastAttemptAt, timezone)
                          : l.contacted
                            ? shortDate(
                                l.contactedAt
                                  ? dayInZone(timezone, new Date(l.contactedAt))
                                  : l.contacted,
                              )
                            : "—"}
                    </td>
                    <td>
                      <div className="row-actions">
                        <MapsButton url={l.mapsUrl} name={l.name} />
                        {mode !== "archive" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setAttemptId(l.id)}
                            aria-label={`Record attempt for ${l.name}`}
                          >
                            <Plus size={17} />
                          </Button>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Actions for ${l.name}`}
                            >
                              <MoreHorizontal size={18} />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem
                              onSelect={() => setSelectedId(l.id)}
                            >
                              <ArrowUpRight size={15} />
                              View details
                            </DropdownMenuItem>
                            {phoneLink(l.phone) &&
                              !l.suppressed &&
                              !l.archived && (
                                <DropdownMenuItem asChild>
                                  <SafeCallLink lead={l}>
                                    <Phone size={15} />
                                    Call business
                                  </SafeCallLink>
                                </DropdownMenuItem>
                              )}
                            <DropdownMenuItem
                              disabled={saving}
                              onSelect={() =>
                                l.archived
                                  ? void archive(l.id, false)
                                  : setArchiveTarget(l)
                              }
                            >
                              <Archive size={15} />
                              {l.archived ? "Restore lead" : "Archive lead"}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="pagination">
          <span>
            {total
              ? `${(currentPage - 1) * 15 + 1}–${Math.min(currentPage * 15, total)} of ${total} leads`
              : "0 leads"}
          </span>
          <div>
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous page"
              disabled={currentPage <= 1}
              onClick={() => change({ page: currentPage - 1 })}
            >
              <ChevronLeft size={16} />
            </Button>
            <span>
              {currentPage} <span className="muted">/ {pageCount}</span>
            </span>
            <Button
              variant="outline"
              size="icon"
              aria-label="Next page"
              disabled={currentPage >= pageCount}
              onClick={() => change({ page: currentPage + 1 })}
            >
              <ChevronRight size={16} />
            </Button>
          </div>
        </div>
      </section>
    );
  }
  if (mode === "page" && !pageInfo)
    return (
      <EmptyState
        title="Page not found"
        description="This page is unavailable or has been deleted."
        action={
          <Button asChild>
            <Link href="/dash/pages">Back to lead pages</Link>
          </Button>
        }
      />
    );
  return (
    <>
      <div className="back-row">
        {mode === "page" ? (
          <Link href="/dash/pages">
            <ArrowLeft size={14} />
            All lead pages
          </Link>
        ) : (
          <span className="eyebrow">YOUR CALLING WORKSPACE</span>
        )}
        <span className="subtle-label">PRIVATE WORKSPACE</span>
      </div>
      <PageHeader
        title={
          mode === "page"
            ? pageInfo!.name
            : mode === "attempts"
              ? "Every call deserves another chance."
              : "Archive"
        }
        description={
          mode === "page"
            ? "New and interested leads. Unanswered leads move to Attempts; scheduled conversations move to Follow-ups."
            : mode === "attempts"
              ? "Pick up where you left off. No-answer and voicemail leads, all in one place."
              : "Closed conversations, kept out of your way. Restore a lead whenever you need it."
        }
        actions={
          mode === "page" ? (
            <>
              <Button variant="outline" onClick={() => setHistoryOpen(true)}>
                Import history
              </Button>
              <Button onClick={() => setImportOpen(true)}>
                <Upload size={16} />
                Import leads
              </Button>
            </>
          ) : undefined
        }
      />
      <div className="lead-summary-grid">
        <div>
          <span
            className={`summary-icon ${mode === "attempts" ? "orange" : "blue"}`}
          >
            <Folder size={19} />
          </span>
          <span>
            <small>
              {mode === "archive"
                ? "Archived leads"
                : mode === "attempts"
                  ? "Waiting for a response"
                  : "Total leads"}
            </small>
            <strong>
              {summaryReady ? summary.total : "—"}
              <span>businesses</span>
            </strong>
          </span>
        </div>
        <div>
          <span className="summary-icon green">
            <Phone size={19} />
          </span>
          <span>
            <small>{mode === "attempts" ? "No answer" : "Ready to call"}</small>
            <strong>
              {summaryReady
                ? mode === "attempts"
                  ? summary.unanswered
                  : summary.ready
                : "—"}
              <span>{mode === "attempts" ? "leads" : "new leads"}</span>
            </strong>
          </span>
        </div>
        <div>
          <span className="summary-icon purple">
            <ArrowUpRight size={19} />
          </span>
          <span>
            <small>Conversations started</small>
            <strong>
              {summaryReady ? summary.contacted : "—"}
              <span>leads</span>
            </strong>
          </span>
        </div>
      </div>
      {mode === "attempts" && (
        <div className="notice-strip">
          <span className="notice-dot" />
          Three consecutive unsuccessful attempts archive a lead as Exhausted. A
          connected outcome resets the failure streak.
        </div>
      )}
      <div className="lead-list-panel">
        <div className="panel-title">
          <div>
            <h2>
              {mode === "page"
                ? "Active calling queue"
                : mode === "attempts"
                  ? "Your next attempts"
                  : "Archived businesses"}
            </h2>
            <span className="count-pill">
              {summaryReady ? summary.total : "—"}
            </span>
          </div>
          <span className="small muted">
            {mode === "archive"
              ? "Rejected: 20-day retention · Exhausted: retained"
              : "One conversation at a time"}
          </span>
        </div>
        {renderList(false)}
        {renderList(true)}
      </div>
      {selected && (
        <LeadDetails
          key={selected.id}
          lead={selected}
          real
          onSaved={() => {
            setSelected(null);
            refresh();
          }}
          onClose={() => setSelectedId(null)}
          onAttempt={() => {
            setSelectedId(null);
            setAttemptId(selected.id);
          }}
        />
      )}
      <AttemptDialog
        key={attemptId}
        lead={
          (mobileLayout ? mobileRemote : desktopRemote).data.rows.find(
            (l) => l.id === attemptId,
          ) || null
        }
        onClose={() => setAttemptId(null)}
      />
      <Dialog
        open={!!archiveTarget}
        onOpenChange={(open) => {
          if (!open && !saving) setArchiveTarget(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Archive this lead?</DialogTitle>
          <DialogDescription>
            {archiveTarget?.name} will leave the calling queue. Manual archives
            keep their business details and attempt history.
          </DialogDescription>
          <div className="dialog-actions">
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => setArchiveTarget(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={saving}
              onClick={async () => {
                if (archiveTarget) {
                  await archive(archiveTarget.id, true);
                  setArchiveTarget(null);
                }
              }}
            >
              {saving ? "Archiving…" : "Confirm archive"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {importOpen && (
        <CsvImportDialog
          pageId={pageId}
          onClose={() => setImportOpen(false)}
          onImported={refresh}
        />
      )}
      {historyOpen && pageId && (
        <ImportHistory
          pageId={pageId}
          onClose={() => setHistoryOpen(false)}
          onChanged={refresh}
        />
      )}
    </>
  );
}
