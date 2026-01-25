import { describe, expect, it } from 'vitest';
import {
	type AnyTag,
	type ServiceTag,
	Tag,
	type TagType,
	ValueTagIdKey,
} from './tag.js';

describe('Tag System', () => {
	describe('Tag.of() - ValueTag creation', () => {
		it('should create a ValueTag with string id', () => {
			const ApiKeyTag = Tag.of('ApiKey')<string>();

			expect(ApiKeyTag[ValueTagIdKey]).toBe('ApiKey');
		});

		it('should create a ValueTag with symbol id', () => {
			const sym = Symbol('MySymbol');
			const SymbolTag = Tag.of(sym)<number>();

			expect(SymbolTag[ValueTagIdKey]).toBe(sym);
		});

		it('should create ValueTags with different types', () => {
			const StringTag = Tag.of('string')<string>();
			const NumberTag = Tag.of('number')<number>();
			const ObjectTag = Tag.of('object')<{ foo: string }>();
			const FunctionTag = Tag.of('function')<(x: number) => string>();

			// All should be valid ValueTags
			expect(Tag.isValueTag(StringTag)).toBe(true);
			expect(Tag.isValueTag(NumberTag)).toBe(true);
			expect(Tag.isValueTag(ObjectTag)).toBe(true);
			expect(Tag.isValueTag(FunctionTag)).toBe(true);
		});

		it('should create unique ValueTag instances', () => {
			const Tag1 = Tag.of('same-id')<string>();
			const Tag2 = Tag.of('same-id')<string>();

			// Different instances, same id
			expect(Tag1).not.toBe(Tag2);
			expect(Tag1[ValueTagIdKey]).toBe(Tag2[ValueTagIdKey]);
		});
	});

	describe('Tag.id() - Tag identification', () => {
		it('should return constructor name for classes', () => {
			class UserService {}

			expect(Tag.id(UserService)).toBe('UserService');
		});

		it('should return static Tag property if present', () => {
			class ApiClient {
				static readonly Tag = 'MyCustomApiClient';
			}

			expect(Tag.id(ApiClient)).toBe('MyCustomApiClient');
		});

		it('should prefer static Tag over constructor name', () => {
			class SomeClass {
				static readonly Tag = 'CustomName';
			}

			expect(Tag.id(SomeClass)).toBe('CustomName');
		});

		it('should return ValueTag id for ValueTags', () => {
			const ConfigTag = Tag.of('app.config')<{ url: string }>();

			expect(Tag.id(ConfigTag)).toBe('app.config');
		});

		it('should handle symbol ids in ValueTags', () => {
			const sym = Symbol('my-symbol');
			const SymTag = Tag.of(sym)<string>();

			expect(Tag.id(SymTag)).toBe('Symbol(my-symbol)');
		});

		it('should handle anonymous classes', () => {
			const AnonymousClass = class {};

			// Anonymous classes may have empty name
			const id = Tag.id(AnonymousClass);
			expect(typeof id).toBe('string');
		});
	});

	describe('Tag.isServiceTag() - ServiceTag type guard', () => {
		it('should return true for classes', () => {
			class MyService {}

			expect(Tag.isServiceTag(MyService)).toBe(true);
		});

		it('should return true for class expressions', () => {
			const MyService = class {};

			expect(Tag.isServiceTag(MyService)).toBe(true);
		});

		it('should return true for built-in constructors', () => {
			expect(Tag.isServiceTag(Date)).toBe(true);
			expect(Tag.isServiceTag(Map)).toBe(true);
			expect(Tag.isServiceTag(Error)).toBe(true);
		});

		it('should return false for non-functions', () => {
			expect(Tag.isServiceTag({})).toBe(false);
			expect(Tag.isServiceTag('string')).toBe(false);
			expect(Tag.isServiceTag(123)).toBe(false);
			expect(Tag.isServiceTag(null)).toBe(false);
			expect(Tag.isServiceTag(undefined)).toBe(false);
		});

		it('should return false for ValueTags', () => {
			const ConfigTag = Tag.of('config')<object>();

			expect(Tag.isServiceTag(ConfigTag)).toBe(false);
		});

		it('should return false for arrow functions (not constructors)', () => {
			const arrowFn = () => 'hello';
			const arrowFn2 = (x: number) => x * 2;

			// Arrow functions cannot be used with `new`, so they're not ServiceTags
			expect(Tag.isServiceTag(arrowFn)).toBe(false);
			expect(Tag.isServiceTag(arrowFn2)).toBe(false);
		});

		it('should return true for regular functions (can be constructors)', () => {
			// Regular functions CAN be used with `new` in JavaScript
			// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
			const regularFn: Function = function () {
				return 'hello';
			};

			// This is ambiguous - a regular function could be a constructor
			// We accept it as a ServiceTag since it CAN be constructed
			expect(Tag.isServiceTag(regularFn)).toBe(true);
		});
	});

	describe('Tag.isValueTag() - ValueTag type guard', () => {
		it('should return true for ValueTags', () => {
			const ConfigTag = Tag.of('config')<{ url: string }>();

			expect(Tag.isValueTag(ConfigTag)).toBe(true);
		});

		it('should return false for classes', () => {
			class MyService {}

			expect(Tag.isValueTag(MyService)).toBe(false);
		});

		it('should return false for plain objects', () => {
			expect(Tag.isValueTag({})).toBe(false);
			expect(Tag.isValueTag({ foo: 'bar' })).toBe(false);
		});

		it('should return false for primitives', () => {
			expect(Tag.isValueTag('string')).toBe(false);
			expect(Tag.isValueTag(123)).toBe(false);
			expect(Tag.isValueTag(true)).toBe(false);
			expect(Tag.isValueTag(null)).toBe(false);
			expect(Tag.isValueTag(undefined)).toBe(false);
		});
	});

	describe('Tag.isTag() - General tag type guard', () => {
		it('should return true for ServiceTags (classes)', () => {
			class MyService {}

			expect(Tag.isTag(MyService)).toBe(true);
		});

		it('should return true for ValueTags', () => {
			const ConfigTag = Tag.of('config')<object>();

			expect(Tag.isTag(ConfigTag)).toBe(true);
		});

		it('should return false for non-tags', () => {
			expect(Tag.isTag({})).toBe(false);
			expect(Tag.isTag('string')).toBe(false);
			expect(Tag.isTag(123)).toBe(false);
			expect(Tag.isTag(null)).toBe(false);
			expect(Tag.isTag(undefined)).toBe(false);
		});
	});

	describe('TagType - Type extraction', () => {
		it('should extract instance type from ServiceTag', () => {
			class UserService {
				name = 'user';
				getUser() {
					return { id: 1 };
				}
			}

			// Type-level test: TagType should give us UserService
			type Extracted = TagType<typeof UserService>;
			const _typeCheck: Extracted = new UserService();
			expect(_typeCheck.name).toBe('user');
		});

		it('should extract value type from ValueTag', () => {
			interface Config {
				url: string;
				port: number;
			}
			const _ConfigTag = Tag.of('config')<Config>();

			// Type-level test: TagType should give us Config
			type Extracted = TagType<typeof _ConfigTag>;
			const _typeCheck: Extracted = {
				url: 'http://localhost',
				port: 3000,
			};
			expect(_typeCheck.url).toBe('http://localhost');
		});

		it('should work with primitive ValueTags', () => {
			const _StringTag = Tag.of('str')<string>();
			const _NumberTag = Tag.of('num')<number>();

			type ExtractedString = TagType<typeof _StringTag>;
			type ExtractedNumber = TagType<typeof _NumberTag>;

			const _s: ExtractedString = 'hello';
			const _n: ExtractedNumber = 42;

			expect(_s).toBe('hello');
			expect(_n).toBe(42);
		});
	});

	describe('Type compatibility', () => {
		it('ServiceTag should be assignable to AnyTag', () => {
			class MyService {}

			const tag: AnyTag = MyService;
			expect(Tag.isTag(tag)).toBe(true);
		});

		it('ValueTag should be assignable to AnyTag', () => {
			const _ConfigTag = Tag.of('config')<object>();

			const tag: AnyTag = _ConfigTag;
			expect(Tag.isTag(tag)).toBe(true);
		});

		it('class with dependencies should work as ServiceTag', () => {
			class Database {
				query(sql: string) {
					return sql;
				}
			}

			class UserService {
				constructor(private db: Database) {}
				getUsers() {
					return this.db.query('SELECT * FROM users');
				}
			}

			// Both should be valid ServiceTags
			const dbTag: ServiceTag<Database> = Database;
			const userTag: ServiceTag<UserService> = UserService;

			expect(Tag.isServiceTag(dbTag)).toBe(true);
			expect(Tag.isServiceTag(userTag)).toBe(true);
		});

		it('classes extending other classes should work as ServiceTag', () => {
			class BaseService {
				base() {
					return 'base';
				}
			}

			class ExtendedService extends BaseService {
				extended() {
					return 'extended';
				}
			}

			const tag: ServiceTag<ExtendedService> = ExtendedService;
			expect(Tag.isServiceTag(tag)).toBe(true);
			expect(Tag.id(tag)).toBe('ExtendedService');
		});

		it('third-party classes should work as ServiceTag', () => {
			// Simulate a third-party class we can't modify
			class ThirdPartyLogger {
				log(msg: string) {
					console.log(msg);
				}
			}

			const tag: ServiceTag<ThirdPartyLogger> = ThirdPartyLogger;
			expect(Tag.isServiceTag(tag)).toBe(true);
		});
	});

	describe('Edge cases', () => {
		it('should handle class with static Tag set to empty string', () => {
			class EmptyTagService {
				static readonly Tag = '';
			}

			// Empty string is falsy, should fall back to constructor name
			// Actually, empty string IS defined, so it returns empty string
			expect(Tag.id(EmptyTagService)).toBe('');
		});

		it('should handle ValueTag with empty string id', () => {
			const EmptyIdTag = Tag.of('')<string>();

			expect(Tag.id(EmptyIdTag)).toBe('');
		});

		it('should handle class inheriting from another tagged class', () => {
			class Parent {
				static readonly Tag = 'ParentTag';
			}

			class Child extends Parent {
				// Inherits static Tag from Parent
			}

			// Child inherits the static Tag
			expect(Tag.id(Child)).toBe('ParentTag');
		});

		it('should handle class overriding parent Tag', () => {
			class Parent {
				static readonly Tag: string = 'ParentTag';
			}

			class Child extends Parent {
				static override readonly Tag: string = 'ChildTag';
			}

			expect(Tag.id(Parent)).toBe('ParentTag');
			expect(Tag.id(Child)).toBe('ChildTag');
		});
	});
});
