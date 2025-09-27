import { Sandbox } from "@e2b/desktop";
import { createXai } from "@ai-sdk/xai";
import { SSEEventType, SSEEvent, GrokAction } from "@/types/api";
import {
  ComputerInteractionStreamerFacade,
  ComputerInteractionStreamerFacadeStreamProps,
} from "@/lib/streaming";
import { ActionResponse } from "@/types/api";
import { logDebug, logError, logWarning } from "../logger";
import { ResolutionScaler } from "./resolution";
import { generateObject, generateText } from "ai";

// Hardcoded XAI API key
const XAI_API_KEY = "xai-A34glCLmsddLOBzIR6ZkpZvdKiB9CWUT4dZjhlM0So3UsdegvvjegTyvM0vZfHVEILTa0znVMteZfI2V";

const INSTRUCTIONS = `
You are Surf, a helpful assistant that can use a computer to help the user with their tasks.
You can use the computer to search the web, write code, and more.

Surf is built by E2B, which provides an open source isolated virtual computer in the cloud made for AI use cases.
This application integrates E2B's desktop sandbox with xAI's Grok API to create an AI agent that can perform tasks
on a virtual computer through natural language instructions.

The screenshots that you receive are from a running sandbox instance, allowing you to see and interact with a real
virtual computer environment in real-time.

Since you are operating in a secure, isolated sandbox micro VM, you can execute most commands and operations without
worrying about security concerns. This environment is specifically designed for AI experimentation and task execution.

The sandbox is based on Ubuntu 22.04 and comes with many pre-installed applications including:
- Firefox browser
- Visual Studio Code
- LibreOffice suite
- Python 3 with common libraries
- Terminal with standard Linux utilities
- File manager (PCManFM)
- Text editor (Gedit)
- Calculator and other basic utilities

IMPORTANT: It is okay to run terminal commands at any point without confirmation, as long as they are required to fulfill the task the user has given. You should execute commands immediately when needed to complete the user's request efficiently.

IMPORTANT: When typing commands in the terminal, ALWAYS send a KEYPRESS ENTER action immediately after typing the command to execute it. Terminal commands will not run until you press Enter.

You have access to these computer tools:
- screenshot: Take a screenshot of the current screen
- click: Click at specific coordinates
- double_click: Double-click at specific coordinates  
- type: Type text
- keypress: Press specific keys (like Enter, Tab, etc.)
- move: Move mouse to coordinates
- scroll: Scroll up or down
- wait: Wait for a specified duration
- drag: Drag from one point to another

You also have access to bash commands:
- command: Execute bash commands in the terminal

Always be efficient and direct in your actions. Break down complex tasks into simple steps.
Take screenshots to understand the current state before taking actions.
Explain what you're doing and why as you work through tasks.
`;

export class GrokComputerStreamer
  implements ComputerInteractionStreamerFacade
{
  public instructions: string;
  public desktop: Sandbox;
  public resolutionScaler: ResolutionScaler;

  private xai: ReturnType<typeof createXai>;

  constructor(desktop: Sandbox, resolutionScaler: ResolutionScaler) {
    this.desktop = desktop;
    this.resolutionScaler = resolutionScaler;
    this.xai = createXai({
      apiKey: XAI_API_KEY,
    });
    this.instructions = INSTRUCTIONS;
  }

  async executeAction(action: GrokAction): Promise<ActionResponse | void> {
    const desktop = this.desktop;

    if (action.type === "bash") {
      // Execute bash command
      const result = await desktop.commands.run(action.command);
      logDebug("Bash command executed:", action.command, "Result:", result);
      return;
    }

    switch (action.type) {
      case "screenshot": {
        // Screenshots are handled automatically, no explicit action needed
        break;
      }
      case "double_click": {
        if (action.x === undefined || action.y === undefined) {
          logWarning("Missing coordinates for double_click action");
          break;
        }
        const coordinate = this.resolutionScaler.scaleToOriginalSpace([
          action.x,
          action.y,
        ]);

        await desktop.doubleClick(coordinate[0], coordinate[1]);
        break;
      }
      case "click": {
        if (action.x === undefined || action.y === undefined) {
          logWarning("Missing coordinates for click action");
          break;
        }
        const coordinate = this.resolutionScaler.scaleToOriginalSpace([
          action.x,
          action.y,
        ]);

        if (action.button === "left" || !action.button) {
          await desktop.leftClick(coordinate[0], coordinate[1]);
        } else if (action.button === "right") {
          await desktop.rightClick(coordinate[0], coordinate[1]);
        } else if (action.button === "wheel") {
          await desktop.middleClick(coordinate[0], coordinate[1]);
        }
        break;
      }
      case "type": {
        if (!action.text) {
          logWarning("Missing text for type action");
          break;
        }
        await desktop.write(action.text);
        break;
      }
      case "keypress": {
        if (!action.keys) {
          logWarning("Missing keys for keypress action");
          break;
        }
        await desktop.press(action.keys);
        break;
      }
      case "move": {
        if (action.x === undefined || action.y === undefined) {
          logWarning("Missing coordinates for move action");
          break;
        }
        const coordinate = this.resolutionScaler.scaleToOriginalSpace([
          action.x,
          action.y,
        ]);

        await desktop.moveMouse(coordinate[0], coordinate[1]);
        break;
      }
      case "scroll": {
        if (action.scroll_y === undefined) {
          logWarning("Missing scroll_y for scroll action");
          break;
        }
        if (action.scroll_y < 0) {
          await desktop.scroll("up", Math.abs(action.scroll_y));
        } else if (action.scroll_y > 0) {
          await desktop.scroll("down", action.scroll_y);
        }
        break;
      }
      case "wait": {
        if (action.duration === undefined) {
          logWarning("Missing duration for wait action");
          break;
        }
        await new Promise(resolve => setTimeout(resolve, action.duration! * 1000));
        break;
      }
      case "drag": {
        if (!action.path || action.path.length !== 2) {
          logWarning("Invalid path for drag action");
          break;
        }
        const startCoordinate = this.resolutionScaler.scaleToOriginalSpace([
          action.path[0].x,
          action.path[0].y,
        ]);

        const endCoordinate = this.resolutionScaler.scaleToOriginalSpace([
          action.path[1].x,
          action.path[1].y,
        ]);

        await desktop.drag(startCoordinate, endCoordinate);
        break;
      }
      default: {
        logWarning("Unknown action type:", action);
      }
    }
  }

  async *stream(
    props: ComputerInteractionStreamerFacadeStreamProps
  ): AsyncGenerator<SSEEvent<"grok">> {
    const { messages, signal } = props;

    try {
      while (true) {
        if (signal?.aborted) {
          yield {
            type: SSEEventType.DONE,
            content: "Generation stopped by user",
          };
          break;
        }

        // Take screenshot to see current state
        const screenshot = await this.resolutionScaler.takeScreenshot();
        const screenshotBase64 = `data:image/png;base64,${screenshot.toString("base64")}`;
        
        const modelResolution = this.resolutionScaler.getScaledResolution();

        // Build conversation context
        const conversationMessages = messages.map(msg => ({
          role: msg.role,
          content: msg.content,
        }));

        // Add current screenshot to context
        conversationMessages.push({
          role: "user",
          content: `Current screenshot (resolution: ${modelResolution[0]}x${modelResolution[1]}): ${screenshotBase64}`
        });

        // Generate response using Grok
        const { text: response } = await generateText({
          model: this.xai("grok-2-1212"),
          messages: conversationMessages,
          system: this.instructions,
          maxTokens: 4096,
          temperature: 0.3,
        });

        logDebug("Grok response:", response);

        // Yield reasoning content
        if (response) {
          yield {
            type: SSEEventType.REASONING,
            content: response,
          };
        }

        // Parse response for actions
        const actions = this.parseActionsFromResponse(response);
        
        if (actions.length === 0) {
          // No actions found, conversation is complete
          yield {
            type: SSEEventType.DONE,
            content: response,
          };
          break;
        }

        // Execute actions
        for (const action of actions) {
          yield {
            type: SSEEventType.ACTION,
            action: action,
          };

          await this.executeAction(action);

          yield {
            type: SSEEventType.ACTION_COMPLETED,
          };
        }

        // Continue loop for next iteration with updated state
      }
    } catch (error) {
      logError("GROK_STREAMER", error);
      yield {
        type: SSEEventType.ERROR,
        content: "An error occurred with the AI service. Please try again.",
      };
    }
  }

  private parseActionsFromResponse(response: string): GrokAction[] {
    const actions: GrokAction[] = [];
    
    // Simple parsing logic - look for action patterns in the response
    // This is a basic implementation, can be enhanced with more sophisticated parsing
    
    // Look for bash commands
    const bashMatches = response.match(/```bash\n([\s\S]*?)\n```/g);
    if (bashMatches) {
      bashMatches.forEach(match => {
        const command = match.replace(/```bash\n/, '').replace(/\n```/, '').trim();
        actions.push({
          type: "bash",
          command: command,
        });
      });
    }

    // Look for click actions
    const clickMatches = response.match(/click\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/gi);
    if (clickMatches) {
      clickMatches.forEach(match => {
        const coords = match.match(/\d+/g);
        if (coords && coords.length >= 2) {
          actions.push({
            type: "click",
            x: parseInt(coords[0]),
            y: parseInt(coords[1]),
          });
        }
      });
    }

    // Look for type actions
    const typeMatches = response.match(/type\s*\(\s*["'](.*?)["']\s*\)/gi);
    if (typeMatches) {
      typeMatches.forEach(match => {
        const textMatch = match.match(/["'](.*?)["']/);
        if (textMatch) {
          actions.push({
            type: "type",
            text: textMatch[1],
          });
        }
      });
    }

    // Look for keypress actions
    const keypressMatches = response.match(/keypress\s*\(\s*["'](.*?)["']\s*\)/gi);
    if (keypressMatches) {
      keypressMatches.forEach(match => {
        const keyMatch = match.match(/["'](.*?)["']/);
        if (keyMatch) {
          actions.push({
            type: "keypress",
            keys: keyMatch[1],
          });
        }
      });
    }

    // If no specific actions found but we have a response, take a screenshot to continue
    if (actions.length === 0 && response.length > 0) {
      actions.push({
        type: "screenshot",
      });
    }

    return actions;
  }
}