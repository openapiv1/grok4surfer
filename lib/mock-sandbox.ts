// Mock E2B Sandbox for testing in environments where E2B API is not accessible
export class MockSandbox {
  public sandboxId: string = "mock-sandbox-id";
  
  constructor() {
    this.stream = {
      start: async () => {},
      getUrl: () => "mock://vnc-url"
    };
    
    this.commands = {
      run: async (command: string) => {
        console.log(`Mock executing command: ${command}`);
        return { stdout: "mock output", stderr: "", exitCode: 0 };
      }
    };
  }

  stream: any;
  commands: any;

  static async create(config: any) {
    console.log("Creating mock sandbox with config:", config);
    return new MockSandbox();
  }

  static async connect(sandboxId: string, config: any) {
    console.log("Connecting to mock sandbox:", sandboxId);
    return new MockSandbox();
  }

  setTimeout(timeout: number) {
    console.log("Setting mock timeout:", timeout);
  }

  async leftClick(x: number, y: number) {
    console.log(`Mock left click at (${x}, ${y})`);
  }

  async rightClick(x: number, y: number) {
    console.log(`Mock right click at (${x}, ${y})`);
  }

  async middleClick(x: number, y: number) {
    console.log(`Mock middle click at (${x}, ${y})`);
  }

  async doubleClick(x: number, y: number) {
    console.log(`Mock double click at (${x}, ${y})`);
  }

  async write(text: string) {
    console.log(`Mock typing: ${text}`);
  }

  async press(keys: string) {
    console.log(`Mock pressing keys: ${keys}`);
  }

  async moveMouse(x: number, y: number) {
    console.log(`Mock moving mouse to (${x}, ${y})`);
  }

  async scroll(direction: string, amount: number) {
    console.log(`Mock scrolling ${direction} by ${amount}`);
  }

  async drag(start: [number, number], end: [number, number]) {
    console.log(`Mock dragging from (${start[0]}, ${start[1]}) to (${end[0]}, ${end[1]})`);
  }

  async takeScreenshot() {
    console.log("Mock taking screenshot");
    // Return a simple 1x1 pixel PNG as base64
    return Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  }

  async screenshot() {
    console.log("Mock taking screenshot via screenshot method");
    // Return a simple 1x1 pixel PNG as base64
    return Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  }
}