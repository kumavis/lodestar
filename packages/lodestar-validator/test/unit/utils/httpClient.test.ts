import {assert} from "chai";
import Axios from "axios";
import MockAdapter from "axios-mock-adapter";
import {HttpClient} from "../../../src/util";
import {describe, it, beforeEach} from "mocha";
import {ILogger, WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import sinon from "sinon";

interface IUser {
  id?: number;
  name: string;
}

describe("httpClient test", () => {
  let mock: MockAdapter;
  let httpClient: HttpClient;

  beforeEach(() => {
    mock = new MockAdapter(Axios);
    const logger: ILogger = sinon.createStubInstance(WinstonLogger);
    httpClient = new HttpClient({}, {logger});
  });

  it("should handle successful GET request correctly", async () => {
    mock.onGet("/users/1").reply(
      200, {id: 1, name: "John Smith"}
    );
    const user: IUser = await httpClient.get<IUser>("/users/1");
    assert.equal(user.id, 1);
    assert.equal(user.name, "John Smith");
  });

  it("should handle successful POST request correctly", async () => {
    mock.onPost("/users", {name: "New comer"}).reply(200, "The user 'New comer' was saved successfully");
    const result: string = await httpClient.post<IUser, string>("/users", {name: "New comer"});
    assert.equal(result, "The user 'New comer' was saved successfully");
  });

  it("should handle http status code 404 correctly", async () => {
    try {
      await httpClient.get<IUser>("/wrong_url");
    } catch(e) {
      assert.equal(e.message, "404");
    }
  });

  it("should handle http status code 500 correctly", async () => {
    mock.onGet("/users/!").reply(
      500, "internal server error"
    );
    try {
      await httpClient.get<IUser>("/users/!");
    } catch(e) {
      assert.equal(e.message, "500");
    }
  });
});
