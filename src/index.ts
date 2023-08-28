import { ServerCredentials } from "@grpc/grpc-js";
import { Config, config } from "./config";
import { PageError, PageSetupError, Renderer, ScreenshotError } from "./renderer";
import puppeteer, { TimeoutError } from "puppeteer";
import { createServer, ServerError, Status } from "nice-grpc";
import { HealthDefinition, HealthServiceImpl, HealthState } from "nice-grpc-server-health";
import {
  RendertronServiceDefinition,
  RendertronServiceImplementation
} from "../generated/_proto/nemoengineering/rendertron/v1/rendertron";

class Rendertron {
  private server = createServer();
  private  healthState = HealthState()
  private readonly config: Config;
  private renderer!: Renderer;

  constructor(config: Config) {
    this.config = config;
  }

  async createRenderer() {
    const browser = await puppeteer.launch({ args: this.config.puppeteerArgs, headless: "new"});

    browser.on("disconnected", () => {
      this.createRenderer();
    });

    this.renderer = new Renderer(browser, this.config);
  }

  async initialize() {
    await this.createRenderer();

    this.configureRendertronService();
    this.configureHealthService();

    const listener = `${this.config.host}:${this.config.port}`;
    console.log(`Listening on: ${listener}`)
    await this.server.listen(listener, ServerCredentials.createInsecure())
  }

  private configureRendertronService() {
    const service: RendertronServiceImplementation = {
       screenshot: async (call) => {
        console.log("screenshot of: ", call.url);

        try {
          return await this.renderer
          .screenshot(call)
        } catch (err) {
          throw Rendertron.handleError(err);
        }

      },
      serialize: async (call) => {
        console.log("serializing of: ", call.url);

        try {
          return await this.renderer
            .serialize(call);
        } catch (err) {
          throw Rendertron.handleError(err);
        }
      },
    };

    this.server.add(RendertronServiceDefinition, service);
  }

  private configureHealthService() {
    this.server.add(HealthDefinition, HealthServiceImpl(this.healthState))
  }

  private static handleError(
    err: unknown
  ): ServerError {
    console.error(err);
    if (err instanceof PageError) {
      return  new ServerError(Status.FAILED_PRECONDITION, `Requested page returned non 2xx code. (Code: ${err.status})`)
    } else if (err instanceof PageSetupError) {
      return  new ServerError(Status.FAILED_PRECONDITION, err.message)
    } else if (err instanceof ScreenshotError) {
      return  new ServerError(Status.INTERNAL, err.message)
    } else if (err instanceof TimeoutError) {
      return  new ServerError(Status.ABORTED, err.message)
    } else {
      return  new ServerError(Status.INTERNAL, "Internal Error")
    }
  }
}

const rendertron = new Rendertron(config);
rendertron.initialize();
