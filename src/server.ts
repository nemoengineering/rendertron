import { createServer, ServerError, Status } from "nice-grpc";
import { HealthDefinition, HealthServiceImpl, HealthState } from "nice-grpc-server-health";
import { Config } from "./config";
import { PageError, PageSetupError, Renderer, ScreenshotError } from "./renderer";
import { ServerCredentials } from "@grpc/grpc-js";
import puppeteer, { TimeoutError } from "puppeteer";
import {
  RendertronServiceDefinition,
  RendertronServiceImplementation
} from "../generated/_proto/nemoengineering/rendertron/v1/rendertron";
import pino from "pino";

export class Server {
  private static readonly logger = pino({base: {"service": "server"}, formatters: { level: (label) => { return { level: label } } }})
  private server = createServer();
  private  healthState = HealthState()
  private readonly config: Config;
  private renderer!: Renderer;

  constructor(config: Config) {
    this.config = config;
  }

  async initialize() {
    Server.logger.info("Starting rendertron slim")
    await this.createRenderer();

    this.configureRendertronService();
    this.configureHealthService();



    const listener = `${this.config.host}:${this.config.port}`;
    const port = await this.server.listen(listener, ServerCredentials.createInsecure())
    Server.logger.info(`Listening on: ${port}`)
  }

  async createRenderer() {
    const browser = await puppeteer.launch({ args: this.config.puppeteerArgs, headless: "new"});

    browser.on("disconnected", () => {
      this.createRenderer();
    });


    this.renderer = new Renderer(browser, this.config);
  }

  private configureRendertronService() {
    const service: RendertronServiceImplementation = {
      screenshot: async (call) => {
        Server.logger.info({url: call.url}, "Taking screenshot")

        try {
          return await this.renderer
            .screenshot(call)
        } catch (err) {
          throw Server.handleError(err);
        }

      },
      serialize: async (call) => {
        Server.logger.info({url: call.url}, "Serializing")

        try {
          return await this.renderer
            .serialize(call);
        } catch (err) {
          throw Server.handleError(err);
        }
      },
    };

    this.server.add(RendertronServiceDefinition, service);
  }

  private configureHealthService() {
    this.server.add(HealthDefinition, HealthServiceImpl(this.healthState))
  }

  shutdown() {
    Server.logger.info("Shutting down...")
    this.server.shutdown()
      .then(() => this.renderer.shutdown() )
  }

  private static handleError(
    err: unknown
  ): ServerError {
    Server.logger.error(err)
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
