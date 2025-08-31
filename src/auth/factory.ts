import BaseAuthClient from "./clients/BaseAuthClient";
import GumloopAuthClient from "./clients/GumloopAuthClient";
import LocalAuthClient from "./clients/LocalAuthClient";

const createAuthClient = <T extends BaseAuthClient<any>>(
  clientType: (new (...args: any[]) => T) | null = null,
  apiKey: string | null = null
): BaseAuthClient<any> => {
  if (clientType) {
    return new clientType();
  }

  const environment: string = (
    process.env.ENVIRONMENT || "local"
  ).toLowerCase();

  if(environment === "gumloop") {
    return new GumloopAuthClient(apiKey || undefined);
  }

  return new LocalAuthClient();


  throw new Error("Client type not provided.");
};

export default createAuthClient;