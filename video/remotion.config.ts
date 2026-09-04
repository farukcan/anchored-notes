import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
// The stage is a live iframe: each frame waits on delayRender while the
// extension reacts, so a generous timeout beats a flaky render.
Config.setDelayRenderTimeoutInMilliseconds(60_000);
