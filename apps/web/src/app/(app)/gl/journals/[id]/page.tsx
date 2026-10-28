'use client';

import { useParams } from 'next/navigation';
import { JournalEditor } from '@/components/JournalEditor';

const JournalPage = () => {
  const params = useParams<{ id: string }>();
  return <JournalEditor id={params.id} />;
};

export default JournalPage;
