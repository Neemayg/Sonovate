"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Loading } from "@/components/Status";

export default function Home() {
  const { session, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) router.replace(session ? "/machines" : "/login");
  }, [loading, session, router]);

  return (
    <main className="container">
      <Loading />
    </main>
  );
}
