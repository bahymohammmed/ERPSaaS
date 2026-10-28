import { Container, getContainer } from '@cloudflare/containers';

type Env = {
  ERP: DurableObjectNamespace<ErpContainer>;
  DATABASE_URL: string;
  JWT_SECRET: string;
  MFA_ENCRYPTION_KEY: string;
};

/** The ERP image (see the repository Dockerfile): web app on 3000, API on 4000 behind it. */
export class ErpContainer extends Container<Env> {
  defaultPort = 3000;
  requiredPorts = [3000, 4000];
  sleepAfter = '30m';

  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env);
    this.envVars = {
      DATABASE_URL: env.DATABASE_URL,
      JWT_SECRET: env.JWT_SECRET,
      MFA_ENCRYPTION_KEY: env.MFA_ENCRYPTION_KEY,
      // The container disk does not survive a restart.
      ATTACHMENT_STORAGE: 'database',
      CLIENT_IP_HEADER: CLIENT_IP_HEADER,
    };
  }
}

const CLIENT_IP_HEADER = 'x-erp-client-ip';

const erp = (env: Env) => getContainer(env.ERP, 'erp');

export default {
  async fetch(request, env) {
    // Overwrite whatever the client sent: only the edge knows the real address.
    const headers = new Headers(request.headers);
    headers.set(CLIENT_IP_HEADER, request.headers.get('cf-connecting-ip') ?? '');
    return erp(env).fetch(new Request(request, { headers }));
  },

  async scheduled(_controller, env, ctx) {
    // Starting the container runs the recurring-entry scheduler shortly after boot.
    ctx.waitUntil(erp(env).fetch(new Request('http://erp/api/health')));
  },
} satisfies ExportedHandler<Env>;
