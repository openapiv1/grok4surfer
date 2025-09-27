import { Sandbox } from "@e2b/desktop";
import { MockSandbox } from "@/lib/mock-sandbox";
import { ComputerInteractionStreamerFacade } from "./index";
import { ResolutionScaler } from "./resolution";

// Placeholder OpenAI streamer to avoid import errors
// This is not the focus of the current task
export class OpenAIComputerStreamer implements ComputerInteractionStreamerFacade {
  public instructions: string = "";
  public desktop: Sandbox | MockSandbox;
  public resolutionScaler: ResolutionScaler;

  constructor(desktop: Sandbox | MockSandbox, resolutionScaler: ResolutionScaler) {
    this.desktop = desktop;
    this.resolutionScaler = resolutionScaler;
  }

  async *stream(): AsyncGenerator<any> {
    throw new Error("OpenAI streamer not implemented");
  }

  async executeAction(): Promise<any> {
    throw new Error("OpenAI streamer not implemented");
  }
}