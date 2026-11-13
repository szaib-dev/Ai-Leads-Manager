"use client";
import { useId, useSyncExternalStore, type ReactNode } from "react";
import { DndContext, KeyboardSensor, PointerSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useWorkspace } from "@/components/providers";
import styles from "./sortable-grid.module.css";

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener("folio:card-order", listener);
  return () => { window.removeEventListener("storage", listener); window.removeEventListener("folio:card-order", listener); };
}
// Stores identifiers only, scoped to the authenticated owner. No lead records are persisted.
export function SortableGrid<T extends { id: string }>({ items, storageKey, className, itemClassName, renderItem, children, wholeCard = false, preserveInputOrder = false, onReorder }: {
  wholeCard?: boolean; preserveInputOrder?: boolean; onReorder?: () => void;
  items: T[]; storageKey: string; className: string; itemClassName?: string;
  renderItem: (item: T, handle: ReactNode) => ReactNode; children?: ReactNode;
}) {
  const { ownerId, toast } = useWorkspace();
  const key = `folio.card-order:${ownerId}:${storageKey}`;
  const raw = useSyncExternalStore(subscribe, () => { try { return localStorage.getItem(key) || "[]"; } catch { return "[]"; } }, () => "[]");
  let order: string[] = [];
  try { const value: unknown = JSON.parse(raw); if (Array.isArray(value)) order = value.filter((id): id is string => typeof id === "string"); } catch {}
  const ordered = preserveInputOrder ? items : [...items].sort((a, b) => {
    const ai = order.indexOf(a.id), bi = order.indexOf(b.id);
    return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi);
  });
  const pointer = useSensor(PointerSensor, { activationConstraint: { distance: 6 } });
  const mouse = useSensor(MouseSensor, { activationConstraint: { distance: 8 } });
  const touch = useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } });
  const keyboard = useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates });
  const sensors = useSensors(...(wholeCard ? [mouse, touch, keyboard] : [pointer, keyboard]));
  const id = useId();
  return <DndContext id={id} sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => {
    if (!over || active.id === over.id) return;
    const visible = ordered.map(item => item.id);
    const moved = arrayMove(visible, visible.indexOf(String(active.id)), visible.indexOf(String(over.id)));
    // Keep hidden/search-filtered cards in their existing slots.
    const full = [...new Set([...order, ...visible])];
    let index = 0;
    const next = full.map(value => visible.includes(value) ? moved[index++] : value);
    try { localStorage.setItem(key, JSON.stringify(next.slice(-2000))); window.dispatchEvent(new Event("folio:card-order")); onReorder?.(); }
    catch { toast("Could not save this order. Allow browser storage and try again."); }
  }}>
    <SortableContext items={ordered.map(item => item.id)} strategy={rectSortingStrategy}>
      <div className={className}>{ordered.map(item => <SortableItem key={item.id} id={item.id} wholeCard={wholeCard} className={itemClassName}>{handle => renderItem(item, handle)}</SortableItem>)}{children}</div>
    </SortableContext>
  </DndContext>;
}
function SortableItem({ id, className, children, wholeCard }: { id: string; wholeCard: boolean; className?: string; children: (handle: ReactNode) => ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  return <div ref={setNodeRef} className={`${styles.item} ${wholeCard ? styles.wholeCard : ""} ${className || ""}`}
    {...(wholeCard ? {...attributes, role:"group", "aria-label":"Reorder card", ...listeners, onMouseDown:(event:React.MouseEvent)=>{if(!(event.target as HTMLElement).closest("button,input,textarea,[role=combobox],[data-no-drag]"))listeners?.onMouseDown?.(event);}, onTouchStart:(event:React.TouchEvent)=>{if(!(event.target as HTMLElement).closest("button,input,textarea,[role=combobox],[data-no-drag]"))listeners?.onTouchStart?.(event);}, onKeyDown:(event:React.KeyboardEvent)=>{if(event.target===event.currentTarget)listeners?.onKeyDown?.(event);}, onDragStart:(event:React.DragEvent)=>event.preventDefault()} : {})} data-dragging={isDragging || undefined} style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 2 : undefined }}>
    {children(wholeCard ? null : <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} className={styles.handle} aria-label="Reorder card" title="Drag to reorder · Space then arrow keys with keyboard"><GripVertical size={17}/></button>)}
  </div>;
}
