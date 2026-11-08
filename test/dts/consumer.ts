import {
	type AnyTag,
	type ChildLayer,
	Container,
	Layer,
	type RootLayer,
	ScopedContainer,
	Tag,
} from 'sandly';

class Database {}

class UserService {
	constructor(readonly db: Database) {}
}

const Port = Tag.of('Port')<number>();

export const root = Container.from(
	Layer.service(UserService, [Database])
		.provide(Layer.service(Database, []))
		.merge(Layer.values([Port, 3000]))
);

export async function handleRequest(
	app: ScopedContainer<typeof Database>
): Promise<UserService> {
	await using request = app.childFrom(
		'request',
		Layer.service(UserService, [Database])
	);
	return request.resolve(UserService);
}

export function createRoot<TRequires extends AnyTag, TProvides extends AnyTag>(
	layer: RootLayer<TRequires, TProvides>
): ScopedContainer<TProvides> {
	return ScopedContainer.from('root', layer);
}

export function createChild<
	TParentTags extends AnyTag,
	TRequires extends AnyTag,
	TProvides extends AnyTag,
>(
	parent: ScopedContainer<TParentTags>,
	layer: ChildLayer<TRequires, TProvides, TParentTags>
): ScopedContainer<TParentTags | TProvides> {
	return parent.childFrom('child', layer);
}

export const singletonRoot = createRoot(Layer.singleton(Database, []));
