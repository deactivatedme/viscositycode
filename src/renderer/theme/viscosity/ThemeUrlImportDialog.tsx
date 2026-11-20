/**
 * ViscosityCode: the "Import theme from URL…" dialog. It only downloads and
 * validates; the caller decides what to do with the document (de-duplicate,
 * then review it in the custom theme editor before anything is saved).
 */
import { useEffect, useRef, useState } from "react";
import { Description, Label, Modal, TextField } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ThemeDocument } from "@/shared/customThemes";
import { Button, Input } from "@/renderer/components/common";
import {
  checkThemeUrl,
  fetchThemeFromUrl,
  type ThemeUrlErrorCode,
  type ThemeUrlImportResult,
} from "./themeUrlImport";

type ThemeUrlError = { code: ThemeUrlErrorCode; status?: number };

function ThemeUrlErrorText(props: { error: ThemeUrlError }) {
  const status = props.error.status;
  switch (props.error.code) {
    case "empty":
      return <Trans>Paste a link to a theme JSON file.</Trans>;
    case "invalid-url":
      return (
        <Trans>
          This is not a valid link. Paste a full address such as https://example.com/theme.json.
        </Trans>
      );
    case "not-https":
      return <Trans>Only secure https:// links can be imported.</Trans>;
    case "redirect":
      return <Trans>The link redirects too many times or to an address that is not https.</Trans>;
    case "too-large":
      return <Trans>The file is larger than 32 KB.</Trans>;
    case "timeout":
      return <Trans>The server did not respond within 10 seconds.</Trans>;
    case "http-error":
      return status === undefined ? (
        <Trans>The server answered with an error.</Trans>
      ) : (
        <Trans>The server answered with an error (HTTP {status}).</Trans>
      );
    case "not-theme":
      return (
        <Trans>
          The link does not point to a version 1 theme JSON file with a name and valid light and
          dark palettes.
        </Trans>
      );
    case "busy":
      return <Trans>Other theme downloads are still running. Try again in a moment.</Trans>;
    case "unavailable":
      return (
        <Trans>
          Importing from a link isn't available here yet. Download the theme file and use Import
          theme.
        </Trans>
      );
    case "network":
      return <Trans>Could not download the file. Check the link and your connection.</Trans>;
  }
}

export interface ThemeUrlImportDialogProps {
  onClose: () => void;
  onImported: (doc: ThemeDocument) => void;
  /** Injectable for tests; defaults to the desktop download bridge. */
  fetchTheme?: (url: string) => Promise<ThemeUrlImportResult>;
}

export function ThemeUrlImportDialog(props: ThemeUrlImportDialogProps) {
  const { t } = useLingui();
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ThemeUrlError | null>(null);
  // A late reply after Cancel/close must not reopen anything.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const submit = async () => {
    if (pending) return;
    const checked = checkThemeUrl(url);
    if (!checked.ok) {
      setError({ code: checked.code });
      return;
    }
    setError(null);
    setPending(true);
    const result = await (props.fetchTheme ?? fetchThemeFromUrl)(checked.url);
    if (!mounted.current) return;
    setPending(false);
    if (result.ok) props.onImported(result.doc);
    else
      setError(
        result.status === undefined
          ? { code: result.code }
          : { code: result.code, status: result.status },
      );
  };

  return (
    <Modal.Backdrop
      isOpen
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-[520px]" data-vc-theme-url-import="">
          <Modal.CloseTrigger aria-label={t`Close`} />
          <Modal.Header>
            <Modal.Heading>
              <Trans>Import theme from URL</Trans>
            </Modal.Heading>
          </Modal.Header>
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <Modal.Body className="flex flex-col gap-3 p-4">
              <TextField
                value={url}
                onChange={(value) => {
                  setUrl(value);
                  setError(null);
                }}
                isInvalid={error !== null}
                isReadOnly={pending}
              >
                <Label>
                  <Trans>Theme link</Trans>
                </Label>
                <Input
                  autoFocus // eslint-disable-line jsx-a11y/no-autofocus -- user-opened paste-a-link dialog, expected field focus
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="https://example.com/theme.json"
                />
                <Description className="text-xs text-muted">
                  <Trans>
                    An https link to a version 1 theme JSON file, up to 32 KB. You can review the
                    theme before it is saved.
                  </Trans>
                </Description>
              </TextField>
              {error ? (
                <p role="alert" className="text-xs text-danger">
                  <ThemeUrlErrorText error={error} />
                </p>
              ) : null}
              <p role="status" className="text-xs text-muted empty:hidden">
                {pending ? <Trans>Downloading theme…</Trans> : null}
              </p>
            </Modal.Body>
            <Modal.Footer>
              <Button slot="close" size="sm" variant="ghost" className="text-muted">
                <Trans>Cancel</Trans>
              </Button>
              <Button type="submit" size="sm" variant="tertiary" isPending={pending}>
                <Trans>Import</Trans>
              </Button>
            </Modal.Footer>
          </form>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
