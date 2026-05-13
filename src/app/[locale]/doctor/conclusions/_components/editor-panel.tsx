"use client";

import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ClipboardListIcon,
  EraserIcon,
  EyeIcon,
  FileTextIcon,
  HistoryIcon,
  LanguagesIcon,
  MicIcon,
  MoreHorizontalIcon,
  PillIcon,
  PlusIcon,
  SaveIcon,
  SearchIcon,
  SparklesIcon,
  StethoscopeIcon,
  TagIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  MOCK_DIAGNOSIS_PRIMARY,
  MOCK_DIAGNOSIS_SECONDARY,
  MOCK_EDITOR_SECTIONS,
  type EditorSection,
} from "../_mocks";

const SECTION_ICON: Record<EditorSection["icon"], LucideIcon> = {
  complaints: ClipboardListIcon,
  anamnesis: HistoryIcon,
  exam: StethoscopeIcon,
  diagnosis: TagIcon,
  rx: PillIcon,
  advice: FileTextIcon,
};

const TOP_ACTIONS = [
  { key: "ai-fill", Icon: SparklesIcon, label: "AI заполнить", primary: true },
  { key: "ai-gen", Icon: FileTextIcon, label: "Сгенерировать заключение", primary: true },
  { key: "template", Icon: ClipboardListIcon, label: "Из шаблона", primary: true },
  { key: "voice", Icon: MicIcon, label: "Голосовой ввод" },
  { key: "lang", Icon: LanguagesIcon, label: "RU / UZ" },
] as const;

export function EditorPanel() {
  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {/* Top toolbar */}
        <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto border-b border-border px-2 py-2">
          {TOP_ACTIONS.map(({ key, Icon, label, primary }) => (
            <button
              key={key}
              type="button"
              className={cn(
                "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium transition-colors",
                primary
                  ? "text-primary hover:bg-primary/10"
                  : "text-foreground hover:bg-muted",
              )}
            >
              <Icon
                className={cn("size-4", !primary && "text-muted-foreground")}
              />
              {label}
            </button>
          ))}
          <button
            type="button"
            aria-label="Ещё"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <MoreHorizontalIcon className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Дальше"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronRightIcon className="size-4" />
          </button>
        </div>

        {/* Editor sections */}
        <div className="divide-y divide-border">
          {MOCK_EDITOR_SECTIONS.slice(0, 3).map((s) => (
            <SectionRow key={s.key} section={s} />
          ))}

          <DiagnosisRow />

          {MOCK_EDITOR_SECTIONS.slice(3).map((s) => (
            <SectionRow key={s.key} section={s} />
          ))}
        </div>

        {/* Bottom action bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <SecondaryBtn Icon={EyeIcon}>Предпросмотр</SecondaryBtn>
            <SecondaryBtn Icon={EraserIcon}>Очистить</SecondaryBtn>
          </div>
          <div className="flex items-center gap-2">
            <SecondaryBtn Icon={SaveIcon}>Сохранить черновик</SecondaryBtn>
            <div className="inline-flex h-9 overflow-hidden rounded-lg bg-primary">
              <button
                type="button"
                className="motion-press inline-flex items-center gap-2 px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Подписать и сохранить
              </button>
              <button
                type="button"
                aria-label="Дополнительные действия"
                className="flex items-center justify-center border-l border-primary-foreground/20 px-2 text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <ChevronDownIcon className="size-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SectionHeader({
  label,
  Icon,
  showAiAdd = true,
}: {
  label: string;
  Icon: LucideIcon;
  showAiAdd?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
        <Icon className="size-4 text-muted-foreground" />
        {label}
      </div>
      <div className="flex items-center gap-1">
        {showAiAdd ? <AiFillBadge /> : null}
        <IconBtn aria="Добавить">
          <PlusIcon className="size-4" />
        </IconBtn>
        <IconBtn aria="Свернуть">
          <ChevronUpIcon className="size-4" />
        </IconBtn>
      </div>
    </div>
  );
}

function SectionRow({ section }: { section: EditorSection }) {
  const Icon = SECTION_ICON[section.icon];
  return (
    <div className="px-5 py-4">
      <SectionHeader label={section.label} Icon={Icon} />

      <div className="mt-3 text-sm leading-relaxed text-foreground">
        {section.list && Array.isArray(section.body) ? (
          <ul className="space-y-1.5 pl-1">
            {section.body.map((line, i) => (
              <li key={i} className="flex gap-2">
                <span
                  aria-hidden
                  className="mt-2 size-1 shrink-0 rounded-full bg-foreground"
                />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-lg border border-border px-3 py-2">
            {section.body as string}
          </div>
        )}
      </div>
    </div>
  );
}

function DiagnosisRow() {
  return (
    <div className="px-5 py-4">
      <SectionHeader label="Диагноз" Icon={TagIcon} showAiAdd={false} />

      <DiagnosisField
        code={MOCK_DIAGNOSIS_PRIMARY.code}
        name={MOCK_DIAGNOSIS_PRIMARY.name}
      />

      <div className="mt-3 text-xs font-medium text-muted-foreground">
        Сопутствующие диагнозы
      </div>
      {MOCK_DIAGNOSIS_SECONDARY.map((d) => (
        <DiagnosisField key={d.code} code={d.code} name={d.name} />
      ))}
    </div>
  );
}

function DiagnosisField({ code, name }: { code: string; name: string }) {
  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
      <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary tabular-nums">
        {code}
      </span>
      <span className="flex-1 truncate text-sm text-foreground">{name}</span>
      <button
        type="button"
        aria-label="Очистить"
        className="text-muted-foreground transition-colors hover:text-foreground"
      >
        <PlusIcon className="size-4 rotate-45" />
      </button>
      <button
        type="button"
        aria-label="Найти"
        className="text-muted-foreground transition-colors hover:text-foreground"
      >
        <SearchIcon className="size-4" />
      </button>
    </div>
  );
}

function AiFillBadge() {
  return (
    <button
      type="button"
      className="inline-flex h-7 items-center gap-1 rounded-md bg-primary/10 px-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/15"
    >
      <SparklesIcon className="size-3" />
      AI дополнить
    </button>
  );
}

function IconBtn({
  aria,
  children,
}: {
  aria: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={aria}
      className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}

function SecondaryBtn({
  Icon,
  children,
}: {
  Icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
    >
      <Icon className="size-4 text-muted-foreground" />
      {children}
    </button>
  );
}
