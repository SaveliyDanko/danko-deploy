import { generateAutomationToken, hashAutomationToken } from "../services/AutomationToken.js";

const token = generateAutomationToken();

console.log("\nСохраните токен в менеджере секретов — повторно получить его из хэша нельзя:\n");
console.log(`DANKODEPLOY_TOKEN=${token}`);
console.log("\nДобавьте на сервер панели:\n");
console.log(`DANKODEPLOY_AUTOMATION_TOKEN_HASH=${hashAutomationToken(token)}`);
