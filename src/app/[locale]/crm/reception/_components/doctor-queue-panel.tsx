"use client";

/**
 * Expanded queue panel that drops below a doctor row in {@link DoctorQueueList}.
 *
 * Renders every appointment for the selected doctor (today) as a compact row:
 *   [grip] [#] [time] [avatar] [name + phone/service] [status pill] [primary advance] [⋯]
 *
 * Status advances reuse the existing `useSetQueueStatus(id)` mutation per row
 * (optimistic + toast + invalidates the reception surfaces). NO_SHOW goes
 * through an AlertDialog to prevent fat-fingers; everything else is one click.
 *
 * Two-lanes layout (docs/TZ-two-lanes.md): the middle splits into «Живая
 * очередь» (live lane = waiting walk-ins, FIFO, drag-and-drop via @dnd-kit —
 * drop triggers `useReorderQueue` which persists `queueOrder` 1..N) and
 * «Записи» (schedule lane = bookings sorted by slot time, never draggable —
 * the reorder API 422s on non-walk-in ids). IN_PROGRESS stays pinned at the
 * top and off-path rows (COMPLETED/CANCELLED/...) sit at the bottom.
 */
import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ChevronsUpIcon,
  ExternalLinkIcon,
  GripVerticalIcon,
  MoreHorizontalIcon,
  PhoneCallIcon,
  PlayIcon,
  PlusIcon,
  UserCheckIcon,
  UserXIcon,
  XIcon,
  CheckIcon,
} from "lucide-react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getQuickActions,
  type LifecycleRole,
} from "@/lib/appointments/lifecycle";
import type { AppointmentStatus } from "@/lib/appointment-transitions";
import { isLiveLane } from "@/lib/queue-ordering";
import type { AppointmentRow } from "../../appointments/_hooks/use-appointments-list";
import { compareQueuePriority } from "../../appointments/_hooks/use-appointments-list";
import {
  useReorderQueue,
  useSetQueuePriority,
  useSetQueueStatus,
} from "../../appointments/_hooks/use-appointment";
import { useCurrentRole } from "../../patients/[id]/_hooks/use-current-role";

export interface DoctorQueuePanelProps {
  appointments: AppointmentRow[];
  doctorId: string;
  onOpenAppointment: (id: string) => void;
  onAddAppointment: (doctorId: string) => void;
}

const STATUS_TINT: Record<AppointmentRow["queueStatus"], string> = {
  BOOKED: "border-border bg-muted/40 text-muted-foreground",
  CONFIRMED: "border-info/40 bg-info/10 text-[color:var(--info)]",
  WAITING: "border-warning/40 bg-warning/10 text-warning-text",
  IN_PROGRESS: "border-success/40 bg-success/15 text-[color:var(--success)]",
  COMPLETED: "border-border bg-card text-muted-foreground",
  SKIPPED: "border-warning/40 bg-warning/10 text-warning-text",
  CANCELLED: "border-border bg-card text-muted-foreground line-through",
  NO_SHOW: "border-destructive/40 bg-destructive/10 text-destructive",
};

// Schedule-lane statuses shown in the «Записи» section. WAITING here is an
// arrived booking (checked in at reception/kiosk) — per the two-lanes TZ it
// stays in the schedule lane with a «Пришёл» badge and never gets a queue
// position, so it is not draggable either.
const BOOKED_SECTION_STATUSES = new Set<AppointmentRow["queueStatus"]>([
  "BOOKED",
  "CONFIRMED",
  "WAITING",
]);

// Roles allowed to reorder — mirrors RBAC on POST /api/crm/appointments/reorder.
const REORDER_ROLES = new Set<LifecycleRole>([
  "ADMIN",
  "SUPER_ADMIN",
  "RECEPTIONIST",
]);

// Live-lane FIFO: urgency bump → arrival (queuedAt) → ticketSeq. The extra
// date tiebreak only catches legacy rows where all three keys collide.
function sortLive(rows: AppointmentRow[]): AppointmentRow[] {
  return [...rows].sort((a, b) => {
    const c = compareQueuePriority(a, b);
    if (c !== 0) return c;
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });
}

const bySlotTime = (a: AppointmentRow, b: AppointmentRow) =>
  new Date(a.date).getTime() - new Date(b.date).getTime();

export function DoctorQueuePanel({
  appointments,
  doctorId,
  onOpenAppointment,
  onAddAppointment,
}: DoctorQueuePanelProps) {
  const t = useTranslations("reception.doctorsPanel.panel");
  const role = useCurrentRole() as LifecycleRole;
  const canReorder = REORDER_ROLES.has(role);
  const reorder = useReorderQueue();

  const { inProgress, live, booked, offPath } = React.useMemo(() => {
    const ip: AppointmentRow[] = [];
    const lv: AppointmentRow[] = [];
    const bk: AppointmentRow[] = [];
    const op: AppointmentRow[] = [];
    for (const row of appointments) {
      // Lane = f(channel), not status (TZ I2): a walk-in that isn't WAITING
      // yet (or anymore) has no queue position, so it falls to off-path.
      if (row.queueStatus === "IN_PROGRESS") ip.push(row);
      else if (isLiveLane(row) && row.queueStatus === "WAITING") lv.push(row);
      else if (!isLiveLane(row) && BOOKED_SECTION_STATUSES.has(row.queueStatus))
        bk.push(row);
      else op.push(row);
    }
    ip.sort(bySlotTime);
    bk.sort(bySlotTime);
    op.sort(bySlotTime);
    return { inProgress: ip, live: sortLive(lv), booked: bk, offPath: op };
  }, [appointments]);

  // Local override during a drag — dnd-kit needs the items array to reflect
  // the new position the moment drop fires; we then mutate to persist. The
  // optimistic cache write rewrites `queueOrder` so the next render derives
  // the same order from props, at which point this state can be cleared.
  const [pendingOrder, setPendingOrder] = React.useState<string[] | null>(null);
  React.useEffect(() => {
    if (!pendingOrder) return;
    // Once cached data agrees with our pending order, drop the override.
    const ids = live.map((r) => r.id);
    if (
      ids.length === pendingOrder.length &&
      ids.every((id, i) => id === pendingOrder[i])
    ) {
      setPendingOrder(null);
    }
  }, [live, pendingOrder]);

  const visibleLive = React.useMemo(() => {
    if (!pendingOrder) return live;
    const byId = new Map(live.map((r) => [r.id, r]));
    const out: AppointmentRow[] = [];
    for (const id of pendingOrder) {
      const r = byId.get(id);
      if (r) out.push(r);
    }
    // Any new id arriving mid-drag (rare) goes to the bottom.
    for (const r of live) if (!pendingOrder.includes(r.id)) out.push(r);
    return out;
  }, [live, pendingOrder]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = visibleLive.findIndex((r) => r.id === active.id);
    const newIndex = visibleLive.findIndex((r) => r.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(visibleLive, oldIndex, newIndex);
    const orderedIds = next.map((r) => r.id);
    setPendingOrder(orderedIds);
    reorder.mutate(
      { doctorId, orderedIds },
      {
        onError: () => setPendingOrder(null),
      },
    );
  };

  if (
    inProgress.length === 0 &&
    visibleLive.length === 0 &&
    booked.length === 0 &&
    offPath.length === 0
  ) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-3">
        <span className="text-xs text-muted-foreground">{t("queueEmpty")}</span>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={() => onAddAppointment(doctorId)}
        >
          <PlusIcon className="size-3" />
          {t("addAppointment")}
        </Button>
      </div>
    );
  }

  // Numbering restarts per section: for the live lane it is the actual queue
  // position 1..N (what the receptionist announces); bookings/off-path get a
  // positional index within their own list — they have no queue position.
  return (
    <ul
      className="flex flex-col divide-y divide-border rounded-lg border border-border bg-background"
      aria-label={t("ariaLabel")}
    >
      {inProgress.map((row, i) => (
        <QueuePanelRow
          key={row.id}
          index={i + 1}
          row={row}
          onOpenAppointment={onOpenAppointment}
        />
      ))}

      {visibleLive.length > 0 ? (
        <SectionHeading label={t("sectionLive")} />
      ) : null}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={visibleLive.map((r) => r.id)}
          strategy={verticalListSortingStrategy}
        >
          {visibleLive.map((row, i) => (
            <SortableQueueRow
              key={row.id}
              index={i + 1}
              row={row}
              draggable={canReorder}
              onOpenAppointment={onOpenAppointment}
            />
          ))}
        </SortableContext>
      </DndContext>

      {booked.length > 0 ? (
        <SectionHeading label={t("sectionBooked")} hint={t("bookedHint")} />
      ) : null}
      {booked.map((row, i) => (
        <QueuePanelRow
          key={row.id}
          index={i + 1}
          row={row}
          onOpenAppointment={onOpenAppointment}
        />
      ))}

      {offPath.map((row, i) => (
        <QueuePanelRow
          key={row.id}
          index={i + 1}
          row={row}
          onOpenAppointment={onOpenAppointment}
        />
      ))}
    </ul>
  );
}

function SectionHeading({ label, hint }: { label: string; hint?: string }) {
  return (
    <li className="bg-muted/30 px-3 py-1.5">
      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </span>
      {hint ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </li>
  );
}

interface SortableQueueRowProps {
  index: number;
  row: AppointmentRow;
  draggable: boolean;
  onOpenAppointment: (id: string) => void;
}

function SortableQueueRow({
  index,
  row,
  draggable,
  onOpenAppointment,
}: SortableQueueRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.id, disabled: !draggable });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Keep dragged row above siblings; otherwise a slight z stack glitch
    // makes the divider lines bleed through the floating ghost.
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.85 : undefined,
  };

  return (
    <QueuePanelRow
      ref={setNodeRef}
      style={style}
      isDragging={isDragging}
      dragHandleProps={draggable ? { ...attributes, ...listeners } : undefined}
      index={index}
      row={row}
      onOpenAppointment={onOpenAppointment}
    />
  );
}

interface QueuePanelRowProps {
  index: number;
  row: AppointmentRow;
  onOpenAppointment: (id: string) => void;
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
  isDragging?: boolean;
  style?: React.CSSProperties;
}

const QueuePanelRow = React.forwardRef<HTMLLIElement, QueuePanelRowProps>(
  function QueuePanelRow(
    { index, row, onOpenAppointment, dragHandleProps, isDragging, style },
    ref,
  ) {
    const t = useTranslations("reception.doctorsPanel.panel");
    const tStatus = useTranslations("appointments.status");
    // «Пришёл» badge lives in the doctorQueue namespace (shared with the card).
    const tQueue = useTranslations("reception.doctorQueue");
    const locale = useLocale();
    const role = useCurrentRole() as LifecycleRole;
    const apptDate = React.useMemo(() => new Date(row.date), [row.date]);
    const mutation = useSetQueueStatus(row.id);
    const priorityMutation = useSetQueuePriority(row.id);

    const actions = React.useMemo(
      () => getQuickActions(row.queueStatus, role, apptDate),
      [row.queueStatus, role, apptDate],
    );

    const primary = actions.find((a) => !a.confirm) ?? null;
    const overflow = actions.filter((a) => a !== primary);

    // Manual urgency reorders the live lane only — bookings have no queue
    // position to bump (two-lanes TZ I1/I2).
    const canPrioritize = isLiveLane(row) && row.queueStatus === "WAITING";
    const isUrgent = (row.queuePriority ?? 0) > 0;
    // Arrived booking: checked in, but stays in the schedule lane.
    const arrivedBooking = !isLiveLane(row) && row.queueStatus === "WAITING";

    const [confirmTarget, setConfirmTarget] =
      React.useState<AppointmentStatus | null>(null);

    const handle = (next: AppointmentStatus) => {
      mutation.mutate(next);
    };

    const time = new Date(row.date).toLocaleTimeString(
      locale === "uz" ? "uz-UZ" : "ru-RU",
      { hour: "2-digit", minute: "2-digit", hour12: false },
    );

    const confirmedTime = row.confirmedAt
      ? new Date(row.confirmedAt).toLocaleTimeString(
          locale === "uz" ? "uz-UZ" : "ru-RU",
          { hour: "2-digit", minute: "2-digit", hour12: false },
        )
      : null;
    const confirmedViaLabel = row.confirmedVia
      ? t(`confirmedVia.${row.confirmedVia}`)
      : null;
    const confirmedTooltip =
      confirmedTime && confirmedViaLabel
        ? t("confirmedTooltip", {
            time: confirmedTime,
            via: confirmedViaLabel,
          })
        : confirmedTime
          ? t("confirmedTooltipNoVia", { time: confirmedTime })
          : undefined;

    return (
      <li
        ref={ref}
        style={style}
        className={cn(
          "relative flex items-center gap-3 px-3 py-2.5",
          isDragging && "bg-muted/40 shadow-sm",
        )}
      >
        {dragHandleProps ? (
          <button
            type="button"
            aria-label={t("dragHandle")}
            className="-ml-1 flex size-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:cursor-grabbing"
            {...dragHandleProps}
          >
            <GripVerticalIcon className="size-4" />
          </button>
        ) : (
          <span className="size-6 shrink-0" aria-hidden />
        )}
        <span className="w-6 shrink-0 text-center text-[11px] font-semibold tabular-nums text-muted-foreground">
          {index}
        </span>
        <span className="w-12 shrink-0 text-xs font-semibold tabular-nums text-foreground">
          {time}
        </span>
        <AvatarWithStatus
          name={row.patient.fullName}
          src={row.patient.photoUrl}
          size="sm"
        />
        <button
          type="button"
          onClick={() => onOpenAppointment(row.id)}
          className="min-w-0 flex-1 text-left transition-colors hover:text-primary"
        >
          <div className="truncate text-sm font-medium text-foreground">
            {row.patient.fullName}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {row.patient.phone}
            {row.primaryService
              ? ` · ${locale === "uz" ? row.primaryService.nameUz : row.primaryService.nameRu}`
              : ""}
          </div>
        </button>

        <Badge
          variant="outline"
          className={cn(
            "h-6 shrink-0 px-2 text-[11px] font-medium",
            STATUS_TINT[row.queueStatus],
          )}
        >
          {tStatus(row.queueStatus.toLowerCase() as never)}
        </Badge>

        {arrivedBooking ? (
          <Badge
            variant="outline"
            className="h-6 shrink-0 gap-1 border-warning/40 bg-warning/10 px-2 text-[11px] font-medium text-warning-text"
          >
            <UserCheckIcon className="size-3" aria-hidden />
            {tQueue("arrivedBadge")}
          </Badge>
        ) : null}

        {confirmedTime ? (
          <span
            className="hidden h-6 shrink-0 items-center gap-1 rounded-md border border-info/30 bg-info/5 px-1.5 text-[10px] font-medium tabular-nums text-[color:var(--info)] md:inline-flex"
            title={confirmedTooltip}
            aria-label={confirmedTooltip}
          >
            <CheckIcon className="size-3" aria-hidden />
            {confirmedTime}
          </span>
        ) : null}

        {primary ? (
          <Button
            variant="default"
            size="sm"
            disabled={mutation.isPending}
            onClick={() => handle(primary.to)}
            className="h-7 shrink-0 gap-1 px-2.5 text-xs"
          >
            <PrimaryIcon kind={primary.kind} />
            {t(`primary.${primary.kind}`)}
          </Button>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              aria-label={t("more")}
            >
              <MoreHorizontalIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => onOpenAppointment(row.id)}>
              <ExternalLinkIcon className="mr-2 size-3.5" />
              {t("openCard")}
            </DropdownMenuItem>
            {canPrioritize ? (
              <DropdownMenuItem
                disabled={priorityMutation.isPending}
                onSelect={(e) => {
                  e.preventDefault();
                  priorityMutation.mutate(isUrgent ? 0 : 1);
                }}
                className={isUrgent ? undefined : "text-warning-text"}
              >
                <ChevronsUpIcon className="mr-2 size-3.5" />
                {isUrgent ? t("priorityOff") : t("priorityOn")}
              </DropdownMenuItem>
            ) : null}
            {overflow.length > 0 ? <DropdownMenuSeparator /> : null}
            {overflow.map((a) => (
              <DropdownMenuItem
                key={a.kind}
                onSelect={(e) => {
                  e.preventDefault();
                  if (a.confirm) setConfirmTarget(a.to);
                  else handle(a.to);
                }}
                className={
                  a.kind === "NO_SHOW"
                    ? "text-destructive focus:text-destructive"
                    : undefined
                }
              >
                {a.kind === "NO_SHOW" ? (
                  <UserXIcon className="mr-2 size-3.5" />
                ) : a.kind === "CONFIRM" ? (
                  <PhoneCallIcon className="mr-2 size-3.5" />
                ) : a.kind === "ARRIVED" ? (
                  <UserCheckIcon className="mr-2 size-3.5" />
                ) : a.kind === "START" ? (
                  <PlayIcon className="mr-2 size-3.5" />
                ) : (
                  <CheckIcon className="mr-2 size-3.5" />
                )}
                {t(`primary.${a.kind}`)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <AlertDialog
          open={confirmTarget !== null}
          onOpenChange={(v) => {
            if (!v) setConfirmTarget(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("confirm.NO_SHOW.title")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("confirm.NO_SHOW.description", {
                  patient: row.patient.fullName,
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel asChild>
                <Button variant="outline">{t("confirm.cancel")}</Button>
              </AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button
                  variant="destructive"
                  onClick={() => {
                    if (confirmTarget) handle(confirmTarget);
                    setConfirmTarget(null);
                  }}
                >
                  <XIcon className="mr-1 size-3.5" />
                  {t("confirm.proceed")}
                </Button>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </li>
    );
  },
);

function PrimaryIcon({
  kind,
}: {
  kind: "CONFIRM" | "ARRIVED" | "START" | "COMPLETE" | "NO_SHOW";
}) {
  if (kind === "CONFIRM") return <PhoneCallIcon className="size-3.5" />;
  if (kind === "ARRIVED") return <UserCheckIcon className="size-3.5" />;
  if (kind === "START") return <PlayIcon className="size-3.5" />;
  if (kind === "COMPLETE") return <CheckIcon className="size-3.5" />;
  return <UserXIcon className="size-3.5" />;
}
