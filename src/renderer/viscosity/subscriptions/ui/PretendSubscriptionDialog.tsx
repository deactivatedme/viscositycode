/**
 * ViscosityCode: add, edit or delete a pretend subscription, or customize how
 * a real account looks (fork of Poracode). Pretend rows and customized rows
 * look real on the dashboard; this dialog is the one place that says what
 * they are. They stay on this device and are never used to run work.
 */
import { useId, useState, type ReactNode } from "react";
import { Chip, Input, Label, Modal, TextField } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Plus, RotateCcw, Trash2, X } from "lucide-react";
import { Button } from "@/renderer/components/common/Button";
import { ToggleSwitch } from "@/renderer/components/common/ToggleSwitch";
import {
  deletePretendSubscription,
  MAX_PRETEND_BARS,
  MAX_PRETEND_SUBSCRIPTIONS,
  newPretendId,
  PRETEND_LIMITS,
  resetSubscriptionOverride,
  savePretendSubscription,
  saveSubscriptionOverride,
  type PretendSubscription,
  type PretendUsageBar,
  type SubscriptionOverride,
} from "../subscriptionsPrefs";
import type { KnownProviderName } from "../useSubscriptions";

interface BarDraft {
  key: string;
  label: string;
  percent: string;
  reset: string;
}

interface Draft {
  provider: string;
  plan: string;
  account: string;
  bars: BarDraft[];
  /** Customize only: keep the account's real usage instead of typed bars. */
  liveUsage: boolean;
}

/** What the dialog edits: a pretend entry, or a real account's display override. */
export type SubscriptionEditorTarget =
  | { kind: "pretend"; entry: PretendSubscription | undefined }
  | {
      kind: "customize";
      /** The saved override, or the row's real values to start from. */
      source: SubscriptionOverride;
      /** The row's real windows, to start typed bars from. */
      realBars: readonly PretendUsageBar[];
      /** An override is saved now ("Reset to real" can remove it). */
      customized: boolean;
      /** Every account kind the host knows; overrides of others are pruned on save. */
      knownKeys: readonly string[];
    };

function toBarDrafts(bars: readonly PretendUsageBar[]): BarDraft[] {
  return bars.map((bar) => ({
    key: newPretendId(),
    label: bar.label,
    percent: String(bar.usedPercent),
    reset: bar.reset ?? "",
  }));
}

function toDraft(target: SubscriptionEditorTarget): Draft {
  const entry: Omit<SubscriptionOverride, "key"> =
    target.kind === "pretend" ? (target.entry ?? { provider: "", bars: [] }) : target.source;
  return {
    provider: entry.provider,
    plan: entry.plan ?? "",
    account: entry.account ?? "",
    bars: toBarDrafts(entry.bars ?? []),
    liveUsage: target.kind === "customize" && target.source.bars === undefined,
  };
}

/** The values to save, or undefined while a required field is empty. */
function draftValues(
  draft: Draft,
  requirePlan: boolean,
): Omit<SubscriptionOverride, "key"> | undefined {
  const provider = draft.provider.trim();
  const plan = draft.plan.trim();
  const barsMissingName = !draft.liveUsage && draft.bars.some((bar) => !bar.label.trim());
  if (!provider || (requirePlan && !plan) || barsMissingName) {
    return undefined;
  }
  const account = draft.account.trim();
  return {
    provider,
    ...(plan ? { plan } : {}),
    ...(account ? { account } : {}),
    ...(draft.liveUsage ? {} : { bars: typedBars(draft.bars) }),
  };
}

function typedBars(bars: readonly BarDraft[]): PretendUsageBar[] {
  return bars.map((bar) => {
    const reset = bar.reset.trim();
    const percent = Number(bar.percent);
    return {
      label: bar.label.trim(),
      usedPercent: Number.isFinite(percent) ? percent : 0,
      ...(reset ? { reset } : {}),
    };
  });
}

function Field(props: { label: string; children: ReactNode }) {
  return (
    <TextField className="gap-1.5">
      <Label className="text-xs font-medium text-foreground">{props.label}</Label>
      {props.children}
    </TextField>
  );
}

export function PretendSubscriptionDialog(props: {
  target: SubscriptionEditorTarget;
  knownNames: readonly KnownProviderName[];
  /** The plan picker's choices for a typed provider name. */
  planNamesFor: (providerName: string) => readonly string[];
  onClose: () => void;
}) {
  const { target, knownNames, planNamesFor, onClose } = props;
  const { t } = useLingui();
  const suggestionsId = useId();
  const planSuggestionsId = useId();
  const entry = target.kind === "pretend" ? target.entry : undefined;
  const [id] = useState(() => entry?.id ?? newPretendId());
  const [draft, setDraft] = useState(() => toDraft(target));
  const [saveFailed, setSaveFailed] = useState(false);
  const max = MAX_PRETEND_SUBSCRIPTIONS;
  const ready = draftValues(draft, target.kind === "pretend");
  const planNames = planNamesFor(draft.provider);
  const update = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }));
  const updateBar = (key: string, next: Partial<BarDraft>) =>
    setDraft((current) => ({
      ...current,
      bars: current.bars.map((bar) => (bar.key === key ? { ...bar, ...next } : bar)),
    }));

  const save = () => {
    if (!ready) return;
    if (target.kind === "customize") {
      saveSubscriptionOverride({ key: target.source.key, ...ready }, target.knownKeys);
      onClose();
      return;
    }
    // Only the count cap can refuse a ready draft (another window may have added entries).
    if (savePretendSubscription({ id, ...ready, plan: ready.plan ?? "", bars: ready.bars ?? [] }))
      onClose();
    else setSaveFailed(true);
  };

  return (
    <Modal.Backdrop isOpen onOpenChange={(open) => !open && onClose()}>
      <Modal.Container placement="center" scroll="inside">
        <Modal.Dialog className="sm:max-w-[520px]" data-vc-pretend-editor="">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading className="flex items-center gap-2">
              {target.kind === "customize" ? (
                <Trans>Customize subscription</Trans>
              ) : entry ? (
                <Trans>Edit pretend subscription</Trans>
              ) : (
                <Trans>Add pretend subscription</Trans>
              )}
              {target.kind === "customize" && target.customized ? (
                <Chip size="sm" variant="soft" data-vc-customized="">
                  <Trans>Customized</Trans>
                </Chip>
              ) : null}
            </Modal.Heading>
          </Modal.Header>
          <Modal.Body className="flex flex-col gap-4 p-4">
            <p className="text-xs text-muted">
              {target.kind === "customize" ? (
                <Trans>
                  Just for fun: Subscriptions shows what you type here instead of this account's
                  real values, only on this device. Its real usage keeps updating underneath and is
                  what work runs on.
                </Trans>
              ) : (
                <Trans>
                  Just for fun: it shows on Subscriptions like a real one, only on this device. It
                  is never used to run work.
                </Trans>
              )}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t`Provider`}>
                <Input
                  list={suggestionsId}
                  placeholder={knownNames[0]?.label ?? ""}
                  maxLength={PRETEND_LIMITS.provider}
                  value={draft.provider}
                  onChange={(event) => update({ provider: event.target.value })}
                />
              </Field>
              <Field label={t`Plan`}>
                <Input
                  list={planSuggestionsId}
                  placeholder={planNames.at(-1) ?? ""}
                  maxLength={PRETEND_LIMITS.plan}
                  value={draft.plan}
                  onChange={(event) => update({ plan: event.target.value })}
                />
              </Field>
            </div>
            <datalist id={suggestionsId}>
              {knownNames.map((known) => (
                <option key={known.kind} value={known.label}>
                  {known.label}
                </option>
              ))}
            </datalist>
            <datalist id={planSuggestionsId}>
              {planNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </datalist>
            <Field label={t`Account (optional)`}>
              <Input
                placeholder={t`me@example.com`}
                maxLength={PRETEND_LIMITS.account}
                value={draft.account}
                onChange={(event) => update({ account: event.target.value })}
              />
            </Field>
            {target.kind === "customize" ? (
              <ToggleSwitch
                isSelected={draft.liveUsage}
                onChange={(liveUsage) =>
                  update({
                    liveUsage,
                    // Typed bars start from the real windows' names and percents.
                    ...(!liveUsage && draft.bars.length === 0
                      ? { bars: toBarDrafts(target.realBars) }
                      : {}),
                  })
                }
              >
                <span className="text-xs text-foreground">
                  <Trans>Use real usage</Trans>
                </span>
              </ToggleSwitch>
            ) : null}
            {draft.liveUsage ? null : (
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium text-foreground">
                  <Trans>Usage bars (optional)</Trans>
                </span>
                {draft.bars.map((bar, index) => {
                  const position = index + 1;
                  return (
                    <div
                      key={bar.key}
                      className="grid grid-cols-[1fr_72px_1fr_auto] items-center gap-2"
                    >
                      <Input
                        aria-label={t`Bar ${position} name`}
                        placeholder={t`Weekly`}
                        maxLength={PRETEND_LIMITS.barLabel}
                        value={bar.label}
                        onChange={(event) => updateBar(bar.key, { label: event.target.value })}
                      />
                      <Input
                        aria-label={t`Bar ${position} percent used`}
                        type="number"
                        min={0}
                        max={100}
                        value={bar.percent}
                        onChange={(event) => updateBar(bar.key, { percent: event.target.value })}
                      />
                      <Input
                        aria-label={t`Bar ${position} reset text`}
                        placeholder={t`Resets in 2h`}
                        maxLength={PRETEND_LIMITS.reset}
                        value={bar.reset}
                        onChange={(event) => updateBar(bar.key, { reset: event.target.value })}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        isIconOnly
                        className="text-muted"
                        aria-label={t`Remove bar ${position}`}
                        onPress={() =>
                          update({ bars: draft.bars.filter((other) => other.key !== bar.key) })
                        }
                      >
                        <X aria-hidden="true" className="size-3.5" />
                      </Button>
                    </div>
                  );
                })}
                {draft.bars.length < MAX_PRETEND_BARS ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 min-h-7 self-start gap-1 px-2 text-xs"
                    onPress={() =>
                      update({
                        bars: [
                          ...draft.bars,
                          { key: newPretendId(), label: "", percent: "0", reset: "" },
                        ],
                      })
                    }
                  >
                    <Plus aria-hidden="true" className="size-3.5" />
                    <Trans>Add bar</Trans>
                  </Button>
                ) : null}
              </div>
            )}
            {saveFailed ? (
              <p role="alert" className="text-xs text-danger">
                <Trans>Couldn't save: you can have up to {max} pretend subscriptions.</Trans>
              </p>
            ) : null}
          </Modal.Body>
          <Modal.Footer className="items-center">
            {target.kind === "customize" && target.customized ? (
              <Button
                variant="ghost"
                className="mr-auto gap-1"
                onPress={() => {
                  resetSubscriptionOverride(target.source.key);
                  onClose();
                }}
              >
                <RotateCcw aria-hidden="true" className="size-3.5" />
                <Trans>Reset to real</Trans>
              </Button>
            ) : null}
            {entry ? (
              <Button
                variant="danger-soft"
                className="mr-auto gap-1"
                onPress={() => {
                  deletePretendSubscription(entry.id);
                  onClose();
                }}
              >
                <Trash2 aria-hidden="true" className="size-3.5" />
                <Trans>Delete</Trans>
              </Button>
            ) : null}
            <Button slot="close" variant="ghost" className="text-muted">
              <Trans>Cancel</Trans>
            </Button>
            <Button variant="tertiary" isDisabled={!ready} onPress={save}>
              <Trans>Save</Trans>
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
