import { notifications } from '@mantine/notifications';

export const notifySuccess = (message: string): void => {
  notifications.show({ color: 'teal', message, autoClose: 2500 });
};

export const notifyError = (message: string): void => {
  notifications.show({ color: 'red', message, autoClose: 7000 });
};
