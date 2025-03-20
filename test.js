import { execSync } from "node:child_process";

try {
  console.log("-----------");
  const result = execSync("npx -y @modelcontextprotocol/server-everything", {
    encoding: "utf-8",
  });
  console.log("resultresultresultresultresult", result);
} catch (error) {
  console.error("error.message", error.stderr);
}
