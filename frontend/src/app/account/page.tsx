"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { PageHead } from "@/components/PageHead";
import { ErrorMessage } from "@/components/Status";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { deleteAccount, getAlertEmailPreference, setAlertEmailPreference } from "@/lib/api";

function AlertEmailSetting() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAlertEmailPreference()
      .then(setEnabled)
      .catch((err: Error) => setError(err.message));
  }, []);

  async function change(next: boolean) {
    setSaving(true);
    setError(null);
    try {
      await setAlertEmailPreference(next);
      setEnabled(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card appearance" aria-labelledby="alert-email-title">
      <div>
        <h2 id="alert-email-title">Alert emails</h2>
        <p className="muted small">
          One email when a machine starts a new alert (2 of its last 3 checks above its baseline threshold), not for
          every check. Sent to the address you sign in with.
        </p>
        {error && <ErrorMessage>{error}</ErrorMessage>}
      </div>
      <label className="lc-check">
        <input
          type="checkbox"
          checked={enabled ?? false}
          disabled={enabled === null || saving}
          onChange={(e) => change(e.target.checked)}
        />{" "}
        {enabled === null ? "Loading…" : saving ? "Saving…" : enabled ? "On" : "Off"}
      </label>
    </section>
  );
}

function AccountView() {
  const { session } = useAuth();
  const router = useRouter();
  const email = session?.user.email ?? "";

  return (
    <>
      <PageHead eyebrow="Account" title="Your account" meta={email} />

      <section className="card" aria-labelledby="data-title">
        <h2 id="data-title">Your data</h2>
        <p>
          Your machines, recordings, operating context and analysis results are visible only to you. Audio files are
          kept until you delete the recording, the machine or your account.
        </p>
      </section>

      <AlertEmailSetting />

      <section className="card appearance" aria-labelledby="appearance-title">
        <div>
          <h2 id="appearance-title">Appearance</h2>
          <p className="muted small">
            Dark is the default. System follows your device setting. Saved in this browser.
          </p>
        </div>
        <ThemeSwitch />
      </section>

      <section className="card danger-zone" aria-labelledby="delete-account-title">
        <h2 id="delete-account-title">Danger zone</h2>
        <ConfirmDelete
          label="Delete account"
          confirmText={email}
          onConfirm={async () => {
            await deleteAccount();
            router.replace("/login");
          }}
        >
          <p>
            This permanently deletes your login, every machine, every recording and its audio file, all operating
            context and all analysis results.
          </p>
        </ConfirmDelete>
      </section>
    </>
  );
}

export default function AccountPage() {
  return (
    <AppShell>
      <AccountView />
    </AppShell>
  );
}
