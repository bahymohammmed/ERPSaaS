import { config } from '../config';
import { migrate } from './migrate';

migrate(config.migrationDatabaseUrl)
  .then(() => console.log('migrations complete'))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
