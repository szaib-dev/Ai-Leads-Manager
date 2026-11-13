"use client";
import { FaWhatsapp } from "react-icons/fa";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { CountryFolders } from "@/components/leads/country-folders";
import Link from "next/link";
import { TodayCalls } from "./today-calls";
import { logout } from "@/lib/auth/actions";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import {
  Search,
  PhoneIncoming,
  LogOut,
  Archive,
  CalendarClock,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronRight,
  Folder,
  History,
  LayoutDashboard,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PhoneMissed,
  Sparkles,
  Settings2,
  Sun,
  Waves,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspace } from "@/components/providers";
import { ApplicationSettings } from "./settings";
import { SignOutItem } from "@/components/auth/sign-out-item";
const nav = [
  { href: "/dash", label: "Overview", icon: LayoutDashboard },
  { href: "/dash/pages", label: "Lead pages", icon: Folder },
  { href: "/dash/whatsapp", label: "WhatsApp Conversations", icon: FaWhatsapp },
  { href: "/dash/attempts", label: "Attempts", icon: PhoneMissed },
  { href: "/dash/followups", label: "Follow-ups", icon: CalendarClock },
  { href: "/dash/callbacks", label: "Awaiting Callbacks", icon: PhoneIncoming },
  { href: "/dash/activity", label: "Activity", icon: History },
  { href: "/dash/archive", label: "Archive", icon: Archive },
  { href: "/dash/ai", label: "AI workspace", icon: Sparkles },
];
export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { theme, setTheme } = useTheme();
  const { pages, ownerId, toast } = useWorkspace();
  const [profileOpen, setProfileOpen] = useState(false);
  const [signingOut, startSignOut] = useTransition();
  const [lastLeads, setLastLeads] = useState("/dash/pages");
  useEffect(() => {
    const key = `folio.last-leads:${ownerId}`;
    try {
      if (path === "/dash/pages" || path.startsWith("/dash/pages/") || path.startsWith("/dash/countries/")) {
        sessionStorage.setItem(key, path);
        queueMicrotask(()=>setLastLeads(path));
      } else {
        const saved = sessionStorage.getItem(key);
        if (saved && /^\/dash\/(pages|countries)(\/|$)/.test(saved)) queueMicrotask(()=>setLastLeads(saved));
      }
      if (path !== "/dash/search") sessionStorage.setItem(`folio.search-return:${ownerId}`, path);
    } catch {}
  }, [path, ownerId]);
  const [foldersOpen,setFoldersOpen]=useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const router = useRouter();
  useEffect(()=>{const shortcut=(event:KeyboardEvent)=>{const target=event.target as Element;if(event.key==="/" && !event.ctrlKey && !event.metaKey && !target.closest("input,textarea,[contenteditable=true],[role=textbox]")){event.preventDefault();router.push("/dash/search");}};window.addEventListener("keydown",shortcut);return ()=>window.removeEventListener("keydown",shortcut);},[router]);
  const isAi = path === "/dash/ai";
  function openAssistant() {
    const activePage = pages.find((p) => path === `/dash/pages/${p.id}`);
    router.push(activePage ? `/dash/ai?page=${activePage.id}` : "/dash/ai");
  }
  const current = path.startsWith("/dash/settings/") ? {href:path,label:"Integrations",icon:Settings2} : nav.find((n) => n.href === path) ?? nav.find(n=>n.href === "/dash/pages")!;
  const page = pages.find((p) => path === `/dash/pages/${p.id}`);
  const followups = pages.reduce(
    (total, page) => total + page.followupCount,
    0,
  );
  if (path === "/dash/search") return <main id="main-content">{children}</main>;
  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link href="/dash" className="brand" aria-label="Folio overview">
          <span className="brand-mark">
            <Waves size={23} strokeWidth={2.5} />
          </span>
          <span className="brand-name">
            folio<span>.</span>
          </span>
        </Link>
        <div className="workspace-label">
          <span className="workspace-avatar">S</span>
          <div>
            <strong>My workspace</strong>
            <span>Personal workspace</span>
          </div>
          <ChevronDown size={15} />
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav aria-label="Main navigation" className="main-nav">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href === "/dash/pages" ? lastLeads : href}
              title={label}
              aria-label={label}
              aria-current={
                ((href === "/dash" ? path === href : path.startsWith(href)) || (href === "/dash/pages" && path.startsWith("/dash/countries/")))
                  ? "page"
                  : undefined
              }
              className={`nav-item ${((href === "/dash" ? path === href : path.startsWith(href)) || (href === "/dash/pages" && path.startsWith("/dash/countries/"))) ? "active" : ""}`}
            >
              <Icon size={19} />
              <span>{label}</span>
              {label === "Follow-ups" && followups > 0 && (
                <small>{followups}</small>
              )}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="profile" style={{width:"100%",textAlign:"left"}} aria-label="Account menu" onClick={()=>setProfileOpen(true)}><span className="profile-avatar">SB</span><div><strong>Personal account</strong><span>Private workspace</span></div><ChevronDown size={15}/></button>
        </div>
      </aside>
      <div className="main-shell">
        {!isAi && (
          <header className="topbar">
            <div className="breadcrumb">
              <Button
                variant="ghost"
                size="icon"
                className="collapse-button"
                onClick={() => setCollapsed(!collapsed)}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {collapsed ? (
                  <PanelLeftOpen size={18} />
                ) : (
                  <PanelLeftClose size={18} />
                )}
              </Button>
              <Link
                href="/dash"
                className="mobile-brand"
                aria-label="Folio overview"
              >
                <Waves size={23} />
              </Link>
              <span className="breadcrumb-root">Workspace</span>
              <ChevronRight size={13} />
              <span className="breadcrumb-current">
                <span className="desktop-nav-label">{current.label}</span>
                <span className="mobile-nav-label">{current.href === "/dash/whatsapp" ? "WhatsApp" : current.label}</span>
              </span>
              {page && (
                <>
                  <ChevronRight size={13} />
                  <span className="breadcrumb-page">{page.name}</span>
                </>
              )}
            </div>
            <div className="topbar-actions">
              <Button variant="ghost" className="header-search-trigger" aria-label="Search all businesses" onClick={() => router.push("/dash/search")}><Search size={16} /><span>Search</span><kbd>/</kbd></Button>
              <TodayCalls />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Choose theme">
                    <Sun size={18} className="light-theme-icon" />
                    <Moon size={18} className="dark-theme-icon" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {[
                    { value: "light", label: "Light", icon: Sun },
                    { value: "dark", label: "Dark", icon: Moon },
                    { value: "system", label: "System", icon: Monitor },
                  ].map(({ value, label, icon: Icon }) => (
                    <DropdownMenuItem
                      key={value}
                      onSelect={() => setTheme(value)}
                    >
                      <Icon size={16} />
                      {label}
                      <span className="menu-check">
                        {theme === value ? "✓" : ""}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="outline"
                className="header-ai"
                onClick={() => openAssistant()}
              >
                <Sparkles size={15} />
                AI assistant
              </Button>
              <button className="header-avatar profile-trigger" aria-label="Open profile" onClick={()=>setProfileOpen(true)}>SB</button>
            </div>
          </header>
        )}
        <main
          id="main-content"
          className={isAi ? "main-content ai-main-content" : "main-content"}
        >
          {children}

        </main>
      </div>
      <nav className="bottom-nav" aria-label="Mobile navigation">
        {nav.slice(0, 4).map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href === "/dash/pages" ? lastLeads : href}
            aria-current={
              ((href === "/dash" ? path === href : path.startsWith(href)) || (href === "/dash/pages" && path.startsWith("/dash/countries/")))
                ? "page"
                : undefined
            }
          >
            <Icon size={21} />
            <span>{href === "/dash/whatsapp" ? "WhatsApp" : label === "Lead pages" ? "Leads" : label}</span>
          </Link>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="More navigation"
              className={
                path === "/dash/activity" || path === "/dash/archive"
                  ? "more-active"
                  : ""
              }
            >
              <ChartNoAxesCombined size={21} />
              <span>More</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top">
            <DropdownMenuItem onSelect={()=>setFoldersOpen(true)}><Folder size={16}/>Country folders</DropdownMenuItem>
            <DropdownMenuItem asChild><Link href="/dash/callbacks"><PhoneIncoming size={16} />Awaiting Callbacks</Link></DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/dash/activity">
                <History size={16} />
                Activity
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/dash/archive">
                <Archive size={16} />
                Archive
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openAssistant()}>
              <Sparkles size={16} />
              AI assistant
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
              <Settings2 size={16} />
              Settings
            </DropdownMenuItem>
            <SignOutItem />
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>
      <Dialog open={foldersOpen} onOpenChange={setFoldersOpen}><DialogContent onClick={event=>{if((event.target as Element).closest("a"))setFoldersOpen(false);}}><DialogTitle>Lead Pages</DialogTitle><DialogDescription>Countries and their lead pages.</DialogDescription><CountryFolders/></DialogContent></Dialog>
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}><DialogContent className="account-panel">
        <span className="account-portrait">SB</span><DialogTitle>Personal account</DialogTitle><DialogDescription>Your private Folio workspace</DialogDescription>
        <div className="account-options"><button onClick={()=>{setProfileOpen(false);setSettingsOpen(true);}}><Settings2 size={19}/><span>Settings<small>Make Folio feel like you</small></span><ChevronRight size={16}/></button>
        <button disabled={signingOut} onClick={()=>startSignOut(async()=>{try{await logout();}catch{toast("Sign out could not complete. Please try again.");}})}><LogOut size={19}/><span>{signingOut?"Signing out…":"Log out"}<small>See you next time</small></span></button></div>
      </DialogContent></Dialog>
      <ApplicationSettings open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
