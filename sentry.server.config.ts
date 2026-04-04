import * as Sentry from "@sentry/nextjs";
import { sentryConfig } from "@/lib/integrations/sentry";

Sentry.init(sentryConfig);
