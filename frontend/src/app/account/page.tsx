"use client";

import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { PageHead } from "@/components/PageHead";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { deleteAccount } from "@/lib/api";

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
