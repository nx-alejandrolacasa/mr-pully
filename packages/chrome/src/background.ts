import { runBackground } from "@mr-pully/shared/background";

runBackground({ minAlarmMs: 30_000, createsDiscardedTabs: false });
