"use client";
import Link from "next/link";
import { SortableGrid } from "@/components/shared/sortable-grid";
import { dayInZone } from "@/lib/analytics/contracts";
import { useState } from "react";
import { ArrowDownUp, FolderPlus, Plus, Search } from "lucide-react";
import { useWorkspace } from "@/components/providers";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { shortDate } from "@/lib/utils";
import { createCountryPage,movePageLocation } from "@/lib/leads/country-actions";
import { fetchCountries } from "@/lib/leads/browser-reads";
import { useQuery } from "@/lib/workflows/use-query";
import { Select } from "@/components/ui/select";
import { managePage } from "@/lib/leads/actions";
import { CsvImportDialog } from "./csv-import-dialog";
export function PagesManager({countryId,cityId,countryName,pageIds,summaryIds,sectionTitle,intro,headerActions}:{countryId?:string;cityId?:string;countryName?:string;pageIds?:string[];summaryIds?:string[];sectionTitle?:string;intro?:React.ReactNode;headerActions?:React.ReactNode}) {
  const countries=useQuery("country-structure",fetchCountries);
  const [moveId,setMoveId]=useState<string|null>(null);
  const [destination,setDestination]=useState("");
  const [destinationCity,setDestinationCity]=useState("");
  const { pages, refreshPages, toast, timezone } = useWorkspace();
  const [busy, setBusy] = useState(false),
    [editId, setEditId] = useState<string | null>(null),
    [deleteId, setDeleteId] = useState<string | null>(null),
    [importOpen, setImportOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [sort,setSort]=useState("manual");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const scoped = pages.filter(p=>!pageIds || pageIds.includes(p.id));
  const summaryPages=summaryIds ? pages.filter(p=>summaryIds.includes(p.id)) : scoped;
  const filtered = scoped.filter((p) =>
    (p.name+" "+p.description).toLowerCase().includes(search.toLowerCase()),
  ).sort((a,b)=>sort==="leads_desc" ? b.leadCount-a.leadCount : sort==="leads_asc" ? a.leadCount-b.leadCount : 0);
  return (
    <>
      <PageHeader
        eyebrow="A PLACE FOR EVERY POSSIBILITY"
        title={countryName || "Lead Pages"}
        description={`${summaryPages.length} pages · ${summaryPages.reduce((n,p)=>n+p.leadCount,0)} leads · ${summaryPages.reduce((n,p)=>n+p.contactedCount,0)} contacted`}
        actions={
          <>
            {headerActions}
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              Import CSV
            </Button>
            <Button
              onClick={() => {
                setEditId(null);
                setName("");
                setDescription("");
                setOpen(true);
              }}
            >
              <Plus size={17} />
              New lead page
            </Button>
          </>
        }
      />
      {intro}
      <div className="section-heading">
        <div>
          <h2>{sectionTitle || "Lead pages"}</h2>
          <span className="count-pill">{scoped.length}</span>
        </div>
        <div className="collection-tools"><label className="search-field page-search">
          <Search size={16} />
          <input
            aria-label="Search lead pages"
            placeholder="Find a page…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label><label className="collection-sort"><ArrowDownUp size={15}/><Select aria-label="Sort lead pages" value={sort} onValueChange={setSort}><option value="manual">Custom order</option><option value="leads_desc">Most leads first</option><option value="leads_asc">Fewest leads first</option></Select></label></div>
      </div>
      <SortableGrid wholeCard preserveInputOrder={sort!=="manual"} onReorder={()=>setSort("manual")} items={filtered} storageKey={`pages:${countryId || "all"}`} className="page-grid" itemClassName="page-card collection-card" renderItem={(p) => {
          const contacted = p.contactedCount;
          return (
            <>
              <Link href={`/dash/pages/${p.id}`} style={{ display: "block" }}>
                <div className="page-card-top">
                  <span className={`country-icon ${p.color}`}>{p.flag}</span>

                </div>
                <h2>{p.name}</h2>
                <p>{p.description}</p>
                <div className="page-card-stats">
                  <strong>
                    {p.newCount}
                    <span>new leads</span>
                  </strong>
                  <span className="collection-total">{p.leadCount} total inside</span>
                </div>
                <div className="page-progress">
                  <span
                    style={{
                      width: `${p.leadCount ? (contacted / p.leadCount) * 100 : 0}%`,
                    }}
                  />
                </div>
                <div className="page-card-footer">
                  <span>{contacted} contacted</span>
                  <span>
                    Created{" "}
                    {shortDate(
                      p.createdAt
                        ? dayInZone(timezone, new Date(p.createdAt))
                        : p.created,
                    )}
                  </span>
                </div>
              </Link>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditId(p.id);
                    setName(p.name);
                    setDescription(p.description);
                    setOpen(true);
                  }}
                >
                  Rename
                </Button>
                <Button variant="ghost" onClick={() => {setMoveId(p.id);setDestination(countryId === "unassigned" ? "" : countryId || "");setDestinationCity(cityId||"");}}>Move</Button>
                <Button variant="ghost" onClick={() => setDeleteId(p.id)}>
                  Delete
                </Button>
              </div>
            </>
          );
        }}>
        {!search && (
          <button
            className="new-page-card"
            onClick={() => {
              setEditId(null);
              setName("");
              setDescription("");
              setOpen(true);
            }}
          >
            <span>
              <FolderPlus size={24} />
            </span>
            <strong>Make room for more.</strong>
            <p>A new market. A new list. A fresh start.</p>
            <span className="new-page-cta">
              <Plus size={15} />
              Create a lead page
            </span>
          </button>
        )}
      </SortableGrid>
      {filtered.length === 0 && (
        <EmptyState
          title={search ? "No pages match your search" : "Create your first lead page"}
          description={search ? "Try another page name or clear your search." : "Add a page for a city, category, or calling campaign."}
        />
      )}
      <Dialog open={!!moveId} onOpenChange={open=>{if(!open&&!busy)setMoveId(null);}}><DialogContent><DialogTitle>Move lead page</DialogTitle><DialogDescription>Leads and history stay with this page.</DialogDescription><Select aria-label="Destination country" value={destination} onValueChange={value=>{setDestination(value);setDestinationCity("");}}><option value="">Unassigned</option>{countries.data?.countries.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</Select>{destination&&<label className="field-label">City<Select aria-label="Destination city" value={destinationCity} onValueChange={setDestinationCity}><option value="">Country level</option>{countries.data?.cities?.filter(c=>c.country_id===destination).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</Select></label>}<div className="dialog-actions"><Button disabled={busy} onClick={async()=>{if(busy)return;setBusy(true);try{await movePageLocation(moveId!,destination||null,destinationCity||null);await refreshPages();countries.retry();setMoveId(null);}catch(e){toast(e instanceof Error?e.message:"Could not move page");}finally{setBusy(false);}}}>Move page</Button></div></DialogContent></Dialog>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>
            {editId ? "Edit lead page" : "A home for your next leads."}
          </DialogTitle>
          <DialogDescription>
            Create or rename a collection. Changes are saved to your private
            workspace.
          </DialogDescription>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (name.trim()) {
                setBusy(true);
                try {
                  if (editId) {
                    const result = await managePage({
                      id: editId,
                      name,
                      description,
                    });
                    if (result.error) {
                      toast(result.error);
                      return;
                    }
                    await refreshPages();
                  } else {
                    await createCountryPage(name.trim(),description.trim(),countryId && countryId!=="unassigned" ? countryId : null,cityId);
                    await refreshPages();
                  }
                  setName("");
                  setDescription("");
                  setOpen(false);
                } catch {
                  toast("Could not save the page. Please try again.");
                } finally {
                  setBusy(false);
                }
              }
            }}
          >
            <label className="field-label">
              Page name
              <input
                required
                maxLength={50}
                placeholder="e.g. Dubai restaurants"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="field-label">
              Description <span>(optional)</span>
              <textarea
                rows={3}
                maxLength={180}
                placeholder="What connects these businesses?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <div className="dialog-actions">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !name.trim()}>
                <Plus size={16} />
                {busy ? "Saving…" : editId ? "Save changes" : "Create page"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {importOpen && (
        <CsvImportDialog
          initialCountryId={countryId} initialCityId={cityId}
          onClose={() => setImportOpen(false)}
          onImported={() => {}}
        />
      )}
      <Dialog
        open={!!deleteId}
        onOpenChange={(o) => {
          if (!o && !busy) setDeleteId(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Delete this lead page?</DialogTitle>
          <DialogDescription>
            This hides the page and its leads from the workspace. Import history
            and original records remain protected in the database. This page has
            no restore control in Phase 3.
          </DialogDescription>
          <div className="dialog-actions">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setDeleteId(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                if (!deleteId) return;
                setBusy(true);
                try {
                  const r = await managePage({ id: deleteId, remove: true });
                  if (r.error) toast(r.error);
                  else {
                    await refreshPages();
                    setDeleteId(null);
                  }
                } catch {
                  toast("Page deletion failed.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Confirm delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
