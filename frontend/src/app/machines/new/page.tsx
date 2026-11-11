import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { NewMachineWizard } from "@/components/NewMachineWizard";
import { PageHead } from "@/components/PageHead";

export const metadata: Metadata = { title: "Add a machine" };

export default function NewMachinePage() {
  return (
    <AppShell>
      <PageHead crumbs={[{ href: "/machines", label: "Machines" }]} eyebrow="New machine" title="Add a machine" />
      <NewMachineWizard />
    </AppShell>
  );
}
