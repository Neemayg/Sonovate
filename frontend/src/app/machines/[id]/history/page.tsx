import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { Loading } from "@/components/Status";
import { MachineHistory } from "./view";

type Props = PageProps<"/machines/[id]/history">;

// The id is request-time data, so it is read behind a Suspense boundary;
// everything else on the page is fetched in the browser.
async function WithId({ params }: { params: Props["params"] }) {
  const { id } = await params;
  return <MachineHistory id={id} />;
}

export default function MachineHistoryPage({ params }: Props) {
  return (
    <AppShell>
      <Suspense fallback={<Loading />}>
        <WithId params={params} />
      </Suspense>
    </AppShell>
  );
}
