import Swal from 'sweetalert2';

export function alertError(title: string, text?: string) {
  return Swal.fire({ icon: 'error', title, text, confirmButtonColor: '#0f5c4c' });
}

export function alertSuccess(title: string, text?: string) {
  return Swal.fire({ icon: 'success', title, text, confirmButtonColor: '#0f5c4c' });
}

export function alertWarning(title: string, text?: string) {
  return Swal.fire({ icon: 'warning', title, text, confirmButtonColor: '#0f5c4c' });
}
