import { LoginForm } from "@/components/auth/login-form";

export default async function Page({ searchParams }: { searchParams: Promise<{ verified?: string }> }) {
  const { verified } = await searchParams;
  return <LoginForm verified={verified === "1"} />;
}
