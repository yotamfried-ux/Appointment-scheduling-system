import { getRequestConfig } from "next-intl/server";

// Hebrew-only in v1 (docs/00-decisions.md D7); the locale is fixed but the plumbing is ready for more.
export default getRequestConfig(async () => {
  const locale = "he";
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    timeZone: "Asia/Jerusalem",
  };
});
