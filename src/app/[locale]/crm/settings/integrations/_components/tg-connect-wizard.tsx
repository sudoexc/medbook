"use client";

/**
 * 5-step wizard that walks a clinic admin through connecting their Telegram
 * bot. Designed for non-technical users:
 *
 *   Step 1: Why & what we'll do (intro).
 *   Step 2: Create a bot via @BotFather — copy-paste-ready commands, link
 *           that opens BotFather, paste-token field, "Validate" button which
 *           hits POST /validate-token (Telegram getMe).
 *   Step 3: Show the bot preview returned by getMe (avatar emoji, name,
 *           username, ID) and ask "is this your bot?".
 *   Step 4: Auto-config checklist (commands, description, menu button). The
 *           "Connect" button triggers POST /connect which sets up the bot and
 *           registers a webhook against $NEXT_PUBLIC_APP_URL.
 *   Step 5: Success screen with quick links.
 *
 * The dialog manages all wizard state locally; on success it calls the
 * `onConnected` callback so the parent can invalidate caches and re-render
 * the integrations card.
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  CheckCircle2Icon,
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  Loader2Icon,
  SendIcon,
} from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  SettingsApiError,
  settingsFetch,
} from "../../_hooks/use-settings-api";

type BotPreview = {
  id: number;
  username: string;
  firstName: string;
  canJoinGroups: boolean;
  supportsInline: boolean;
};

type ValidateResponse = {
  bot: BotPreview;
  alreadyBoundToOtherClinic: { slug: string; label: string } | null;
};

type ConnectResponse = {
  bot: { id: number; username: string; firstName: string };
  webhookUrl: string;
  miniAppUrl: string;
  warnings: string[];
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: (info: ConnectResponse) => void;
}

const TOKEN_REGEX = /^\d{6,12}:[A-Za-z0-9_-]{30,}$/;

export function TgConnectWizard({ open, onOpenChange, onConnected }: Props) {
  const t = useTranslations("settings.integrations.tgWizard");
  const [step, setStep] = React.useState<1 | 2 | 3 | 4 | 5>(1);
  const [token, setToken] = React.useState("");
  const [bot, setBot] = React.useState<BotPreview | null>(null);
  const [collisionSlug, setCollisionSlug] = React.useState<string | null>(null);
  const [setupCommands, setSetupCommands] = React.useState(true);
  const [setupDescription, setSetupDescription] = React.useState(true);
  const [setupMenuButton, setSetupMenuButton] = React.useState(true);
  const [tokenError, setTokenError] = React.useState<string | null>(null);
  const [connectError, setConnectError] = React.useState<string | null>(null);
  const [connectResult, setConnectResult] = React.useState<ConnectResponse | null>(
    null,
  );

  // Reset state when the dialog opens fresh (so re-opening starts clean).
  React.useEffect(() => {
    if (open) {
      setStep(1);
      setToken("");
      setBot(null);
      setCollisionSlug(null);
      setSetupCommands(true);
      setSetupDescription(true);
      setSetupMenuButton(true);
      setTokenError(null);
      setConnectError(null);
      setConnectResult(null);
    }
  }, [open]);

  const validateMutation = useMutation({
    mutationFn: async (rawToken: string) => {
      return settingsFetch<ValidateResponse>(
        "/api/crm/integrations/tg/validate-token",
        {
          method: "POST",
          body: JSON.stringify({ token: rawToken }),
        },
      );
    },
    onSuccess: (data) => {
      setBot(data.bot);
      setCollisionSlug(data.alreadyBoundToOtherClinic?.slug ?? null);
      setTokenError(null);
      setStep(3);
    },
    onError: (e: Error) => {
      if (e instanceof SettingsApiError) {
        if (e.message === "invalid_token") setTokenError(t("err.invalidToken"));
        else if (e.message === "network_error")
          setTokenError(t("err.network"));
        else setTokenError(t("err.tg", { msg: e.message }));
      } else {
        setTokenError(e.message);
      }
    },
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      return settingsFetch<ConnectResponse>(
        "/api/crm/integrations/tg/connect",
        {
          method: "POST",
          body: JSON.stringify({
            token,
            expectedUsername: bot?.username,
            setupCommands,
            setupDescription,
            setupMenuButton,
          }),
        },
      );
    },
    onSuccess: (data) => {
      setConnectResult(data);
      setConnectError(null);
      setStep(5);
      onConnected(data);
    },
    onError: (e: Error) => {
      if (e instanceof SettingsApiError) {
        const details = (e.details ?? {}) as {
          description?: string | null;
          error_code?: number | null;
          webhookUrl?: string;
        };
        const tgDesc = details.description?.trim();
        const tgCode = details.error_code;
        const tgSuffix =
          tgDesc || tgCode
            ? ` — ${[tgCode ? `${tgCode}` : null, tgDesc].filter(Boolean).join(": ")}`
            : "";
        if (e.message === "bot_in_use") setConnectError(t("err.botInUse"));
        else if (e.message === "username_mismatch")
          setConnectError(t("err.usernameMismatch"));
        else if (e.message === "webhook_unreachable")
          setConnectError(`${t("err.webhookUnreachable")}${tgSuffix}`);
        else if (e.message === "webhook_failed")
          setConnectError(`${t("err.webhookFailed")}${tgSuffix}`);
        else if (e.message === "network_error")
          setConnectError(t("err.network"));
        else setConnectError(`${e.message}${tgSuffix}`);
      } else {
        setConnectError(e.message);
      }
    },
  });

  const onValidateClick = () => {
    if (!TOKEN_REGEX.test(token.trim())) {
      setTokenError(t("err.tokenFormat"));
      return;
    }
    validateMutation.mutate(token.trim());
  };

  const onCopy = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("copied", { key }));
    } catch {
      toast.error(t("err.copyFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SendIcon className="size-4 text-primary" />
            {t("title")}
          </DialogTitle>
          <DialogDescription>
            {t("stepIndicator", { step, total: 5 })} · {t(`step${step}.subtitle`)}
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          {step === 1 ? (
            <Step1 t={t} />
          ) : step === 2 ? (
            <Step2
              t={t}
              token={token}
              setToken={setToken}
              tokenError={tokenError}
              onCopy={onCopy}
              isValidating={validateMutation.isPending}
            />
          ) : step === 3 && bot ? (
            <Step3 t={t} bot={bot} collisionSlug={collisionSlug} />
          ) : step === 4 ? (
            <Step4
              t={t}
              setupCommands={setupCommands}
              setSetupCommands={setSetupCommands}
              setupDescription={setupDescription}
              setSetupDescription={setSetupDescription}
              setupMenuButton={setupMenuButton}
              setSetupMenuButton={setSetupMenuButton}
              connectError={connectError}
            />
          ) : step === 5 && connectResult ? (
            <Step5 t={t} result={connectResult} />
          ) : null}
        </div>

        <DialogFooter className="flex-row justify-between gap-2 sm:justify-between">
          <div>
            {step > 1 && step < 5 ? (
              <Button
                variant="ghost"
                onClick={() => setStep((s) => (s - 1) as typeof step)}
                disabled={validateMutation.isPending || connectMutation.isPending}
              >
                <ArrowLeftIcon className="size-4" />
                {t("back")}
              </Button>
            ) : null}
          </div>

          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={validateMutation.isPending || connectMutation.isPending}
            >
              {step === 5 ? t("close") : t("cancel")}
            </Button>

            {step === 1 ? (
              <Button onClick={() => setStep(2)}>{t("step1.cta")}</Button>
            ) : step === 2 ? (
              <Button
                onClick={onValidateClick}
                disabled={!token.trim() || validateMutation.isPending}
              >
                {validateMutation.isPending ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : null}
                {t("step2.cta")}
              </Button>
            ) : step === 3 ? (
              <Button
                onClick={() => setStep(4)}
                disabled={!!collisionSlug}
                title={collisionSlug ? t("err.botInUse") : undefined}
              >
                {t("step3.cta")}
              </Button>
            ) : step === 4 ? (
              <Button
                onClick={() => connectMutation.mutate()}
                disabled={connectMutation.isPending}
              >
                {connectMutation.isPending ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : null}
                {t("step4.cta")}
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Step1({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <div className="space-y-3 text-sm">
      <p>{t("step1.intro")}</p>
      <ul className="space-y-2 text-muted-foreground">
        <li className="flex gap-2">
          <CheckIcon className="mt-0.5 size-4 shrink-0 text-success" />
          {t("step1.bullet1")}
        </li>
        <li className="flex gap-2">
          <CheckIcon className="mt-0.5 size-4 shrink-0 text-success" />
          {t("step1.bullet2")}
        </li>
        <li className="flex gap-2">
          <CheckIcon className="mt-0.5 size-4 shrink-0 text-success" />
          {t("step1.bullet3")}
        </li>
      </ul>
    </div>
  );
}

function Step2({
  t,
  token,
  setToken,
  tokenError,
  onCopy,
  isValidating,
}: {
  t: ReturnType<typeof useTranslations>;
  token: string;
  setToken: (v: string) => void;
  tokenError: string | null;
  onCopy: (value: string, key: string) => void;
  isValidating: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-3 text-sm">
        <p className="font-medium">{t("step2.heading")}</p>
        <a
          href="https://t.me/BotFather"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-primary hover:underline"
        >
          <ExternalLinkIcon className="size-3.5" />
          {t("step2.openBotFather")}
        </a>
        <ol className="space-y-3 text-xs text-muted-foreground">
          <li>
            <div className="font-medium text-foreground">
              1. {t("step2.cmd1Title")}
            </div>
            <CopyChip value="/newbot" onCopy={onCopy} t={t} />
          </li>
          <li>
            <div className="font-medium text-foreground">
              2. {t("step2.cmd2Title")}
            </div>
            <p>{t("step2.cmd2Hint")}</p>
            <CopyChip
              value={t("step2.cmd2Sample")}
              onCopy={onCopy}
              t={t}
            />
          </li>
          <li>
            <div className="font-medium text-foreground">
              3. {t("step2.cmd3Title")}
            </div>
            <p>{t("step2.cmd3Hint")}</p>
            <CopyChip
              value={t("step2.cmd3Sample")}
              onCopy={onCopy}
              t={t}
            />
          </li>
          <li>
            <div className="font-medium text-foreground">
              4. {t("step2.cmd4Title")}
            </div>
            <p>{t("step2.cmd4Hint")}</p>
          </li>
        </ol>
      </div>

      <div className="space-y-2">
        <Label htmlFor="bot-token">{t("step2.tokenLabel")}</Label>
        <Input
          id="bot-token"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="123456789:AAH..."
          autoComplete="off"
          disabled={isValidating}
        />
        <p className="text-xs text-muted-foreground">{t("step2.tokenHint")}</p>
        {tokenError ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
            <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
            <span>{tokenError}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CopyChip({
  value,
  onCopy,
  t,
}: {
  value: string;
  onCopy: (value: string, key: string) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <button
      type="button"
      onClick={() => onCopy(value, value)}
      className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1 font-mono text-[11px] text-foreground hover:bg-accent"
    >
      <code className="break-all">{value}</code>
      <CopyIcon className="size-3 shrink-0 text-muted-foreground" />
      <span className="sr-only">{t("copy")}</span>
    </button>
  );
}

function Step3({
  t,
  bot,
  collisionSlug,
}: {
  t: ReturnType<typeof useTranslations>;
  bot: BotPreview;
  collisionSlug: string | null;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-2xl">
          🤖
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold">{bot.firstName}</div>
          <a
            href={`https://t.me/${bot.username}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            @{bot.username}
            <ExternalLinkIcon className="size-3" />
          </a>
          <div className="mt-1 text-[11px] text-muted-foreground">
            ID: {bot.id}
          </div>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{t("step3.askConfirm")}</p>
      {collisionSlug ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
          <div>
            <div className="font-medium">{t("err.botInUse")}</div>
            <div className="mt-0.5 text-destructive/80">
              {t("err.botInUseDetail", { slug: collisionSlug })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Step4({
  t,
  setupCommands,
  setSetupCommands,
  setupDescription,
  setSetupDescription,
  setupMenuButton,
  setSetupMenuButton,
  connectError,
}: {
  t: ReturnType<typeof useTranslations>;
  setupCommands: boolean;
  setSetupCommands: (v: boolean) => void;
  setupDescription: boolean;
  setSetupDescription: (v: boolean) => void;
  setupMenuButton: boolean;
  setSetupMenuButton: (v: boolean) => void;
  connectError: string | null;
}) {
  return (
    <div className="space-y-4 text-sm">
      <div>
        <Label className="mb-2 block">{t("step4.autoSetup")}</Label>
        <div className="space-y-1.5">
          <CheckRow
            checked={setupCommands}
            onChange={setSetupCommands}
            label={t("step4.checkCommands")}
            hint={t("step4.checkCommandsHint")}
          />
          <CheckRow
            checked={setupDescription}
            onChange={setSetupDescription}
            label={t("step4.checkDescription")}
            hint={t("step4.checkDescriptionHint")}
          />
          <CheckRow
            checked={setupMenuButton}
            onChange={setSetupMenuButton}
            label={t("step4.checkMenu")}
            hint={t("step4.checkMenuHint")}
          />
        </div>
      </div>

      {connectError ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>{connectError}</span>
        </div>
      ) : null}
    </div>
  );
}

function CheckRow({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-md p-1 hover:bg-accent/40">
      <input
        type="checkbox"
        className="mt-1 size-3.5 cursor-pointer accent-primary"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
    </label>
  );
}

function Step5({
  t,
  result,
}: {
  t: ReturnType<typeof useTranslations>;
  result: ConnectResponse;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 rounded-lg border border-success/30 bg-success/5 p-4">
        <CheckCircle2Icon className="mt-0.5 size-6 shrink-0 text-success" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="text-base font-semibold text-success">
            {t("step5.title")}
          </div>
          <div className="text-sm">@{result.bot.username}</div>
          {result.warnings.length > 0 ? (
            <div className="mt-1 text-[11px] text-muted-foreground">
              {t("step5.warnings", { list: result.warnings.join(", ") })}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <a
          href={`https://t.me/${result.bot.username}`}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ExternalLinkIcon className="size-4" />
          {t("step5.openBot")}
        </a>
      </div>
    </div>
  );
}
