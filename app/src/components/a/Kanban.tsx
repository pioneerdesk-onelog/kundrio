"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type Announcements, type DragEndEvent, type KeyboardCoordinateGetter, type ScreenReaderInstructions } from "@dnd-kit/core";
import { GripVertical } from "lucide-react";

export type KanbanStage = { id: string; name: string; kind: "OPEN" | "WON" | "LOST" | "CLOSED" };
export type KanbanDeal = { id: string; stageId: string; title: string; value: string; contact: string | null; lostReason: string | null; /** false = fehlendes Bearbeiten-Recht, Karte nicht ziehbar */ movable?: boolean; /** Link zur Detailseite */ href?: string };

// Deutsche Hinweise und Ansagen für Screenreader (Standard von dnd-kit ist Englisch)
const SR_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable: "Leertaste drückt die Karte auf. Mit den Pfeiltasten in eine andere Phase bewegen, mit Leertaste ablegen, mit Escape abbrechen. Alternativ die Phase in der Auswahl auf der Karte ändern.",
};
function announcements(stages: KanbanStage[]): Announcements {
  const name = (id: string | number | undefined) => stages.find((x) => x.id === id)?.name ?? "";
  return {
    onDragStart: () => "Karte aufgenommen.",
    onDragOver: ({ over }) => (over ? `Über Phase „${name(over.id)}“.` : "Außerhalb der Phasen."),
    onDragEnd: ({ over }) => (over ? `Karte in Phase „${name(over.id)}“ abgelegt.` : "Karte außerhalb abgelegt, nichts geändert."),
    onDragCancel: () => "Verschieben abgebrochen.",
  };
}

// Tastatur: Pfeil links/rechts springt genau eine Spalte weiter (Spaltenbreite w-64 + Abstand gap-3 = 268 px),
// statt in 25-px-Schritten über die Phasen zu kriechen.
const COLUMN_STEP = 268;
const columnCoordinates: KeyboardCoordinateGetter = (event, { currentCoordinates }) => {
  if (event.code === "ArrowRight") return { ...currentCoordinates, x: currentCoordinates.x + COLUMN_STEP };
  if (event.code === "ArrowLeft") return { ...currentCoordinates, x: currentCoordinates.x - COLUMN_STEP };
  if (event.code === "ArrowDown") return { ...currentCoordinates, y: currentCoordinates.y + 40 };
  if (event.code === "ArrowUp") return { ...currentCoordinates, y: currentCoordinates.y - 40 };
  return undefined;
};

export function Kanban({
  stages,
  deals: initial,
  hidden,
  onMove,
}: {
  stages: KanbanStage[];
  deals: KanbanDeal[];
  /** Je Phase nicht geladene (ältere) Karten – große Pipelines zeigen nur die neuesten (LR-3) */
  hidden?: Record<string, number>;
  /** Gibt bei Ablehnung (z. B. fehlende Berechtigung) { error } zurück statt zu werfen */
  onMove: (dealId: string, stageId: string, lostReason?: string) => Promise<void | { error: string }>;
}) {
  const [deals, setDeals] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  // Maus sofort (auch schnelle Bewegungen/automatische Aufnahmen), Touch erst nach kurzem Halten (sonst kein Scrollen),
  // Tastatur: Leertaste aufnehmen, Pfeiltasten, Leertaste ablegen
  const sensors = useSensors(
    useSensor(MouseSensor),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnCoordinates }),
  );

  // Maus-Ablage selbst bestimmen (Spalte unter dem Loslass-Punkt): Kommen Drücken, Bewegen und Loslassen ohne Pause
  // (schnelle Hand, automatische Aufnahme), meldet dnd-kit kein oder ein veraltetes Ziel (die Ausgangsspalte).
  // dnd-kit bleibt für Anzeige, Tastatur und Touch zuständig.
  const press = useRef<{ dealId: string; x: number; y: number } | null>(null);
  // Nach dem Ziehen den Klick unterdrücken, damit der Titel-Link nicht die Detailseite öffnet
  const justDragged = useRef(false);
  const moveRef = useRef<(dealId: string, stageId: string | null) => void>(() => {});

  useEffect(() => {
    const onUp = (ev: MouseEvent) => {
      const p = press.current;
      press.current = null;
      if (!p || Math.hypot(ev.clientX - p.x, ev.clientY - p.y) < 5) return;
      justDragged.current = true;
      moveRef.current(p.dealId, stageAtPoint(ev.clientX, ev.clientY));
      setTimeout(() => (justDragged.current = false), 0);
    };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, []);

  function handleEnd(e: DragEndEvent) {
    if (e.activatorEvent instanceof MouseEvent) return; // Maus: siehe onUp oben
    move(String(e.active.id), e.over ? String(e.over.id) : null);
  }

  useEffect(() => {
    moveRef.current = move;
  });

  /** Gemeinsame Verschiebe-Logik für Drag & Drop und die Phasen-Auswahl auf der Karte */
  function move(dealId: string, stageId: string | null) {
    const deal = deals.find((d) => d.id === dealId);
    const stage = stages.find((s) => s.id === stageId);
    if (!deal || !stage || deal.stageId === stage.id || deal.movable === false) return;

    let reason: string | undefined;
    if (stage.kind === "LOST") {
      const r = window.prompt("Warum wurde der Deal verloren?");
      if (r === null) return; // abgebrochen
      reason = r;
    }
    const before = deals;
    setDeals((ds) => ds.map((d) => (d.id === dealId ? { ...d, stageId: stage.id, lostReason: reason ?? null } : d)));
    setError(null);
    startTransition(async () => {
      try {
        const res = await onMove(dealId, stage.id, reason);
        if (res && "error" in res) {
          setDeals(before);
          setError(res.error);
        }
      } catch (err) {
        setDeals(before);
        setError(err instanceof Error ? err.message : "Verschieben fehlgeschlagen");
      }
    });
  }

  return (
    <div>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <DndContext sensors={sensors} onDragEnd={handleEnd} onDragCancel={() => (justDragged.current = false)} accessibility={{ screenReaderInstructions: SR_INSTRUCTIONS, announcements: announcements(stages) }}>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {stages.map((s) => (
            <Column key={s.id} stage={s} stages={stages} onSelect={move} deals={deals.filter((d) => d.stageId === s.id)} hidden={hidden?.[s.id] ?? 0} suppressClick={() => justDragged.current} onPress={(dealId, x, y) => (press.current = { dealId, x, y })} />
          ))}
        </div>
      </DndContext>
    </div>
  );
}

type Press = (dealId: string, x: number, y: number) => void;

function Column({ stage, stages, deals, hidden, onSelect, suppressClick, onPress }: { stage: KanbanStage; stages: KanbanStage[]; deals: KanbanDeal[]; hidden: number; onSelect: (dealId: string, stageId: string) => void; suppressClick: () => boolean; onPress: Press }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const tone = stage.kind === "WON" ? "text-green-700 dark:text-green-300" : stage.kind === "LOST" ? "text-red-600 dark:text-red-300" : "";
  return (
    <div
      ref={setNodeRef}
      role="group"
      data-stage-id={stage.id}
      aria-label={`Phase ${stage.name}`}
      className={`w-64 shrink-0 rounded-lg border border-black/10 bg-black/[0.02] p-2 dark:border-white/10 dark:bg-white/[0.03] ${isOver ? "ring-2 ring-accent-500" : ""}`}
    >
      <div className={`mb-2 flex justify-between px-1 text-sm font-semibold ${tone}`}>
        <span>{stage.name}</span>
        <span className="text-ink-400 dark:text-ink-200">{(deals.length + hidden).toLocaleString("de-DE")}</span>
      </div>
      <div className="min-h-16 space-y-2">
        {deals.map((d) => <Card key={d.id} deal={d} stages={stages} onSelect={onSelect} suppressClick={suppressClick} onPress={onPress} />)}
      </div>
      {hidden > 0 && (
        <p className="mt-2 px-1 text-xs text-ink-400 dark:text-ink-200">
          + {hidden.toLocaleString("de-DE")} ältere ausgeblendet (zuletzt bewegte zuerst)
        </p>
      )}
    </div>
  );
}

function Card({ deal, stages, onSelect, suppressClick, onPress }: { deal: KanbanDeal; stages: KanbanStage[]; onSelect: (dealId: string, stageId: string) => void; suppressClick: () => boolean; onPress: Press }) {
  // Ziehen mit der Maus auf der ganzen Karte; Tastatur-Ziehen über den eigenen Griff-Knopf
  // (keine verschachtelten Bedienelemente: die Karte selbst ist kein role="button")
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } = useDraggable({
    id: deal.id, disabled: deal.movable === false, attributes: { roleDescription: "verschiebbare Karte" },
  });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      onMouseDown={(e) => {
        if (deal.movable === false || e.button !== 0) return;
        onPress(deal.id, e.clientX, e.clientY);
        (listeners?.onMouseDown as React.MouseEventHandler<HTMLDivElement> | undefined)?.(e);
      }}
      onTouchStart={listeners?.onTouchStart as React.TouchEventHandler<HTMLDivElement> | undefined}
      onClickCapture={(e) => {
        if (suppressClick()) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      className={`${deal.movable === false ? "cursor-default" : "cursor-grab"} rounded-md border border-black/10 bg-white p-2 text-sm shadow-sm dark:border-white/10 dark:bg-ink-900 ${isDragging ? "z-10 opacity-80 shadow-lg" : ""}`}
    >
      <div className="flex items-start gap-1 font-medium">
        <span className="min-w-0 flex-1">
        {deal.href ? (
          // Klick öffnet die Detailseite; Ziehen am Titel ist erlaubt (startet erst ab 5 px Bewegung)
          <a href={deal.href} draggable={false} className="hover:underline">
            {deal.title}
          </a>
        ) : (
          deal.title
        )}
        </span>
        {deal.movable !== false && (
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            onKeyDown={listeners?.onKeyDown as React.KeyboardEventHandler<HTMLButtonElement> | undefined}
            aria-label={`„${deal.title}“ verschieben`}
            className="-mr-1 shrink-0 cursor-grab rounded p-0.5 text-ink-400 hover:bg-sand-100 dark:text-ink-200 dark:hover:bg-white/10"
          >
            <GripVertical size={14} aria-hidden />
          </button>
        )}
      </div>
      <div className="mt-1 flex justify-between text-xs text-ink-400 dark:text-ink-200">
        <span>{deal.contact ?? "–"}</span>
        <span>{deal.value}</span>
      </div>
      {deal.lostReason && <div className="mt-1 text-xs text-red-600">{deal.lostReason}</div>}
      {deal.movable !== false && (
        // Barrierefreie Alternative zu Drag & Drop (Tastatur, Screenreader, Touch)
        <select
          aria-label={`Phase von „${deal.title}“`}
          value={deal.stageId}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onChange={(e) => onSelect(deal.id, e.target.value)}
          className="mt-2 w-full rounded border border-black/10 bg-transparent px-1 py-0.5 text-xs dark:border-white/15"
        >
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/** Phase (Spalte) unter einem Bildschirmpunkt – über die Spalten-Rechtecke, nicht elementsFromPoint:
 * oben läge sonst die gezogene Karte, deren DOM-Elternteil noch die alte Spalte ist. */
function stageAtPoint(x: number, y: number): string | null {
  for (const col of document.querySelectorAll<HTMLElement>("[data-stage-id]")) {
    const r = col.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return col.dataset.stageId ?? null;
  }
  return null;
}
