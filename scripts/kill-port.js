const { execSync } = require("child_process");

try {
  const output = execSync("netstat -ano | findstr :3000 | findstr LISTENING", {
    encoding: "utf8",
  });
  const pids = [
    ...new Set(
      output
        .trim()
        .split("\n")
        .map((line) => line.trim().split(/\s+/).pop())
    ),
  ];
  pids.forEach((pid) => {
    try {
      execSync(`taskkill /PID ${pid} /F`);
      console.log(`Killed PID ${pid} on port 3000`);
    } catch (e) {
      // ignore
    }
  });
} catch {
  console.log("Port 3000 is free");
}
