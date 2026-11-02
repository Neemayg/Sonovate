import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { Loading } from "@/components/Status";
import { RecordingAnalysis } from "./view";

type Props = PageProps<"/recordings/[id]">;

// The id is request-time data, so it is read behind a Suspense boundary;
// everything else on the page is fetched in the browser.
async function WithId({ params }: { params: Props["params"] }) {
  const { id } = await params;
  return <RecordingAnalysis id={id} />;
}

export default function RecordingPage({ params }: Props) {
  return (
    <AppShell>
      <Suspense fallback={<Loading />}>
        <WithId params={params} />
      </Suspense>
    </AppShell>
  );
}
