'use client';

import { useParams } from 'next/navigation';
import { DocumentEditor } from '@/components/subledger/DocumentEditor';

const Page = () => {
  const { id } = useParams<{ id: string }>();
  return <DocumentEditor key={id} side="AP" id={id} />;
};

export default Page;
